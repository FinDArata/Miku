// Draws Kanon (花音) — the chibi inspired by Mai Kawasumi — into the PNG/ICO set
// Tauri needs. No dependencies: the icons are rasterised here and encoded with
// node:zlib, so the app icon stays "drawn in code" like the character itself.
// Geometry matches design/prototype/kanon.html v4.3 (head-form, 216-unit box).
//
//   node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");

// ── Kanon palette (K_* in engine.ts) ──────────────────────────────────────────

const HAIR = [58, 70, 104];     // #3A4668
const HAIR_D = [42, 51, 80];    // #2A3350
const HAIR_SHINE = [86, 102, 144];
const BOW = [154, 162, 224];    // #9AA2E0
const BOW_D = [123, 131, 200];  // #7B83C8
const SKIN = [255, 233, 220];   // #FFE9DC
const EYE_G1 = [87, 217, 154];  // #57D99A
const EYE_G2 = [13, 122, 82];   // #0D7A52
const EYE_INK = [28, 43, 38];   // #1C2B26
const SAKURA = [244, 114, 182]; // #F472B6
const BLUSH = [244, 167, 185];
const RIM = [16, 19, 26];

const SS = 4; // supersampling factor

// ── shape tests (prototype 0..300 coordinates) ───────────────────────────────

const inEll = (x, y, cx, cy, rx, ry, rot = 0) => {
  const c = Math.cos(-rot), s = Math.sin(-rot);
  const dx = x - cx, dy = y - cy;
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return (lx / rx) ** 2 + (ly / ry) ** 2 <= 1;
};
const inRR = (x, y, cx, cy, w, h, r) => {
  const hw = w / 2, hh = h / 2;
  if (Math.abs(x - cx) > hw || Math.abs(y - cy) > hh) return false;
  const qx = Math.max(-hw + r, Math.min(hw - r, x - cx));
  const qy = Math.max(-hh + r, Math.min(hh - r, y - cy));
  return (x - cx - qx) ** 2 + (y - cy - qy) ** 2 <= r * r;
};
// distance to a quadratic bezier, sampled
const distQuad = (px, py, p0, p1, p2) => {
  let best = 1e9;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, m = 1 - t;
    const bx = m * m * p0[0] + 2 * m * t * p1[0] + t * t * p2[0];
    const by = m * m * p0[1] + 2 * m * t * p1[1] + t * t * p2[1];
    const d = (px - bx) ** 2 + (py - by) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
};

/** Returns [r,g,b,a] 0..255 for one point in the 0..300 prototype box. */
function kanonAt(px, py) {
  // back hair + curtain (rim = hair expanded)
  const inHairTop = inEll(px, py, 150, 64, 88, 80);
  const inCurtain = inRR(px, py, 150, 132, 160, 90, 40);
  const inHair = inHairTop || inCurtain;
  const inHairRim = inEll(px, py, 150, 64, 90, 82) || inRR(px, py, 150, 132, 164, 94, 42);

  // face, locks, bangs
  const inFace = inEll(px, py, 150, 76, 64, 60);
  let inBangs = false;
  for (let i = -2; i <= 2; i++) {
    if (inEll(px, py, 150 + i * 28, 38 + Math.abs(i) * 3, 24, 27, i * 0.05)) { inBangs = true; break; }
  }
  const inLocks = inEll(px, py, 84, 96, 13, 52, 0.08) || inEll(px, py, 216, 96, 13, 52, -0.08);

  // eyes at (120/180, 88), iris 13x19, lid covers top 62%
  let eyeCol = null;
  for (const sd of [-1, 1]) {
    const ex = 150 + sd * 30, ey = 88;
    if (inEll(px, py, ex, ey, 13, 19)) {
      const lidY = ey - 19 * 0.38;
      if (py <= lidY - 1.2) { eyeCol = SKIN; }                       // kelopak
      else if (py <= lidY + 1.3) { eyeCol = EYE_INK; }               // garis kelopak
      else {
        const g = Math.min(1, Math.max(0, (py - (ey - 10)) / 26));
        eyeCol = [0, 1, 2].map((i) => EYE_G1[i] + (EYE_G2[i] - EYE_G1[i]) * g);
        if (inEll(px, py, ex - 3, ey + 2.5, 2.5, 3.2)) eyeCol = [255, 255, 255];
        if (inEll(px, py, ex + 4, ey + 7.5, 1.4, 1.8)) eyeCol = [255, 255, 255];
        const nearEdge =
          Math.abs(Math.sqrt(((px - ex) / 13) ** 2 + ((py - ey) / 19) ** 2) - 1) < 0.09;
        if (nearEdge) eyeCol = EYE_INK;
      }
    }
  }

  // pita belakang: loop mengintip dua sisi (rotated ellipse) + jepit not di kiri
  const inLoop = inEll(px, py, 64, 92, 30, 12, -0.55) || inEll(px, py, 236, 92, 30, 12, 0.55);
  const inTail = inEll(px, py, 150 - 70, 135, 9, 34, 0.12) || inEll(px, py, 150 + 70, 135, 9, 34, -0.12);

  // jepit not ♪ di loop kiri
  let inNote = false;
  {
    const c = Math.cos(0.2), s = Math.sin(0.2), s0 = 16;
    const dx = px - 54, dy = py - 90;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    if (inEll(lx, ly, 0, s0 * 0.32, s0 * 0.36, s0 * 0.26, -0.3)) inNote = true;
    if (lx >= s0 * 0.3 && lx <= s0 * 0.43 && ly >= -s0 * 0.95 && ly <= s0 * 0.32) inNote = true;
    if (lx >= s0 * 0.43 && lx <= s0 * 0.9 && ly >= -s0 * 0.95 && ly <= -s0 * 0.42) inNote = true;
  }

  // ahoge (dua segmen kuadratik, stroke 3.2)
  const ahoge =
    distQuad(px, py, [150, 12], [153, -2], [160, -6]) < 1.7 ||
    distQuad(px, py, [160, -6], [169, -6], [163, 5]) < 1.7;

  // mouth
  const inMouth = px >= 146.5 && px <= 153.5 && py >= 119.6 && py <= 121.4;
  const inBlush = inEll(px, py, 98, 106, 9, 5) || inEll(px, py, 202, 106, 9, 5);

  // painter's algorithm — terakhir menang
  if (inHairRim) {
    if (ahoge) return [...SAKURA, 255];
    if (inHair) {
      if (inNote) return [...SAKURA, 255];
      if (inLoop || inTail) return [...BOW, 255];
      const g = Math.min(1, Math.max(0, (py - 0) / 240));
      const col = [0, 1, 2].map((i) => HAIR[i] + (HAIR_D[i] - HAIR[i]) * g);
      if (inEll(px, py, 116, 26, 6, 15, 0.25) || inEll(px, py, 182, 24, 5.5, 14, -0.2)) return [...HAIR_SHINE, 255];
      if (inFace) {
        if (inMouth) return [...EYE_INK, 255];
        if (inBlush) return [...BLUSH, 255];
        if (eyeCol) return [...eyeCol, 255];
        if (inBangs) {
          if (inEll(px, py, 116, 26, 6, 15, 0.25) || inEll(px, py, 182, 24, 5.5, 14, -0.2)) return [...HAIR_SHINE, 255];
          return [...col, 255];
        }
        return [...SKIN, 255];
      }
      if (inLocks || inBangs) return [...HAIR_D, 255];
      return [...col, 255];
    }
    return [...RIM, 255];
  }
  if (inLoop && inNote) return [...SAKURA, 255];  // not di ujung loop
  return [0, 0, 0, 0];
}

function renderKanon(size) {
  const px = new Uint8Array(size * size * 4);
  // konten proto x[32..268] (236) × y[-16..200] (216) di canvas persegi, dipusatkan
  const k = size / 236;
  const ox = 32, oy = -26;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const jx = (x + (sx + 0.5) / SS) / k + ox;
          const jy = (y + (sy + 0.5) / SS) / k + oy;
          const c = kanonAt(jx, jy);
          r += c[0] * (c[3] / 255); g += c[1] * (c[3] / 255); b += c[2] * (c[3] / 255);
          a += c[3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      px[o] = Math.round(r / n);
      px[o + 1] = Math.round(g / n);
      px[o + 2] = Math.round(b / n);
      px[o + 3] = Math.round(a / n);
    }
  }
  return px;
}

// ── PNG ───────────────────────────────────────────────────────────────────────

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

// ── Go ────────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });

const png = (size) => encodePNG(size, renderKanon(size));

const files = {
  "32x32.png": png(32),
  "128x128.png": png(128),
  "128x128@2x.png": png(256),
  "icon.png": png(512),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data);
  console.log(`${name} — ${data.length} bytes`);
}

const ico = encodeICO([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) })));
writeFileSync(join(OUT, "icon.ico"), ico);
console.log(`icon.ico — ${ico.length} bytes`);
