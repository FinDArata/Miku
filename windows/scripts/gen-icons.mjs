// Builds the PNG/ICO set Tauri needs from **the mascot itself**.
//
// The icon is not a second drawing of Miku that could drift from the real one:
// this script renders src/mochi/engine.ts through a headless browser and crops
// the bust out of it, so changing the chibi (a new palette, a moved ear) changes
// the icon the next time this runs. The engine paints into a canvas, and a
// canvas needs a renderer, hence the browser.
//
//   node scripts/gen-icons.mjs
//
// Needs Chrome or Edge (MIKU_CHROME overrides the path) and the vite dev server
// this script starts and stops itself.
//
// The icon is the classic Miku only: a variant is a runtime wardrobe choice, and
// the app has one icon so the Start menu, the taskbar and the installer agree.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const OUT = join(ROOT, "src-tauri", "icons");

/** The sizes the app ships, and the ones the ICO carries. */
const PNG_SIZES = [32, 128, 256, 512];
const PNG_NAMES = { 32: "32x32.png", 128: "128x128.png", 256: "128x128@2x.png", 512: "icon.png" };
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// ── PNG encoding (for the ICO's own entries) ─────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── ICO (PNG-in-ICO, Vista and later) ─────────────────────────────────────────

function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ── Driving the browser ───────────────────────────────────────────────────────

function findChrome() {
  if (process.env.MIKU_CHROME) return process.env.MIKU_CHROME;
  const candidates = process.platform === "win32"
    ? [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
      ]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ];
  return candidates.find((p) => existsSync(p));
}

/** Runs the headless browser on `url` and returns its DOM as text. */
function dumpDom(chrome, url) {
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--dump-dom",
    "--virtual-time-budget=90000",
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ];
  const res = spawnSync(chrome, args, { encoding: "utf8", timeout: 150_000, maxBuffer: 64 << 20 });
  if (res.error) throw new Error(`could not run ${chrome}: ${res.error.message}`);
  return res.stdout || "";
}

/** The `<pre id="result">` payload: `size<TAB>dataURL` per line. */
function readResult(dom) {
  const m = dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m) throw new Error("the page did not report any icons");
  const text = m[1]
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  const out = new Map();
  for (const line of text.split("\n")) {
    const [size, url] = line.split("\t");
    if (!size || !url || !url.startsWith("data:image/png;base64,")) continue;
    out.set(Number(size), Buffer.from(url.split(",", 2)[1], "base64"));
  }
  if (!out.size) throw new Error("the page reported no usable PNG");
  return out;
}

/** Starts `vite` on a free port and resolves once it is serving. */
async function startVite() {
  if (!existsSync(join(ROOT, "node_modules", "vite"))) {
    throw new Error("run `npm install` first: vite is not installed");
  }
  const port = 5300 + Math.floor(Math.random() * 400);
  const child = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite", "--port", String(port), "--strictPort"],
    // Windows cannot spawn a .cmd directly; the shell is what runs it.
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" },
  );
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("vite did not start in time")), 60_000);
      const onData = (buf) => {
        if (buf.toString().includes("ready in")) {
          clearTimeout(timer);
          setTimeout(resolve, 300);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`vite exited with ${code}`));
      });
    });
  } catch (err) {
    child.kill();
    throw err;
  }
  return { child, url: `http://127.0.0.1:${port}` };
}

// ── Go ────────────────────────────────────────────────────────────────────────

const chrome = findChrome();
if (!chrome) {
  console.error("No Chrome or Edge found. Set MIKU_CHROME to the browser's path.");
  process.exit(1);
}

const all = [...new Set([...PNG_SIZES, ...ICO_SIZES])].sort((a, b) => a - b);
let server;
try {
  server = await startVite();
  const query = encodeURIComponent(JSON.stringify(all));
  const dom = dumpDom(chrome, `${server.url}/scripts/icon-render.html?sizes=${query}`);
  const pngs = readResult(dom);

  mkdirSync(OUT, { recursive: true });
  for (const size of PNG_SIZES) {
    const data = pngs.get(size);
    if (!data) throw new Error(`no ${size}px render`);
    writeFileSync(join(OUT, PNG_NAMES[size]), data);
    console.log(`${PNG_NAMES[size]} — ${data.length} bytes`);
  }

  const ico = encodeICO(ICO_SIZES.map((size) => ({ size, png: pngs.get(size) })));
  writeFileSync(join(OUT, "icon.ico"), ico);
  console.log(`icon.ico — ${ico.length} bytes`);
} finally {
  server?.child.kill();
}

export { encodePNG, encodeICO };
