// Miku speaks: the notification cues in a real Japanese voice, made with
// VOICEVOX and zundamon (Style: ささやき / whisper).
//
// A neural voice cannot be composed in code, so these six cues are recorded
// once and committed to ../voice/. `gen-sounds.mjs` lays them over the chimes
// it generates, which is how a fresh clone and a release build both carry them
// with no extra step. This script is what produces that folder again:
//
//   Requirements: VOICEVOX running, with the engine on http://127.0.0.1:50021
//   node scripts/voice-cues.mjs [--out=<dir>] [--dry-run]
//
// The default output is ../voice/ — the committed set. Point --out at the
// sounds folder the app reads to hear them without rebuilding:
//
//     %APPDATA%\Miku\sounds        (Windows)
//     ~/.config/miku/sounds        (Linux)
//
// A file of the user's own in that folder still wins over the built-in cue
// (src-tauri/src/sounds.rs), so nobody is stuck with these.
//
// CREDIT, which the licence requires wherever the app is presented:
//   VOICEVOX:ずんだもん
//
// Licence: the software may be used commercially and non-commercially with the
// credit above (https://voicevox.hiroshiba.jp/term/); the voice follows the
// character's own terms, which allow commercial and non-commercial use with the
// credit "VOICEVOX:ずんだもん" (https://zunko.jp/con_ongen_kiyaku.html). Both
// are the authority; this note is only a summary.

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE = "http://127.0.0.1:50021";
/** zundamon, ささやき (whisper). The shortest and softest of its styles. */
const SPEAKER = 22;
const CREDIT = "VOICEVOX:ずんだもん";

// `--flag` alone is true, `--key=value` carries the value.
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const raw = a.replace(/^--/, "");
  const eq = raw.indexOf("=");
  return eq < 0 ? [raw, "true"] : [raw.slice(0, eq), raw.slice(eq + 1)];
}));
const dryRun = args["dry-run"] === "true";

/** Where the cues go: the committed set, unless told otherwise. */
function soundsFolder() {
  if (args.out) return resolve(args.out);
  return join(dirname(fileURLToPath(import.meta.url)), "..", "voice");
}

/**
 * What Miku says, and for which of the app's own cues it stands in.
 *
 * Short on purpose: a notification interrupts, so it says one thing and stops.
 * The brackets are zundamon's own speech patterns — it is not Miku's voice, and
 * the app's own chimes stay for anything not listed here.
 */
const CUES = [
  // task finished
  ["finish", "できたよ"],
  // a question, or something waiting for an answer
  ["question", "ちょっといい？"],
  // something went wrong
  ["error", "ごめんね"],
  // approval / yes
  ["approve", "いいよ"],
  // greeting
  ["greeting", "おはよう"],
  // a light attention sound
  ["blip", "ねえ"],
];

function readWav(buf) {
  let off = 12, channels = 1, sr = 44100, dataOff = 0, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") { channels = buf.readUInt16LE(off + 10); sr = buf.readUInt32LE(off + 12); }
    else if (id === "data") { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size + (size % 2);
  }
  const n = Math.floor(dataLen / 2 / channels);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let c = 0; c < channels; c++) v += buf.readInt16LE(dataOff + (i * channels + c) * 2) / 32768;
    s[i] = v / channels;
  }
  return { sr, s };
}

/** 16-bit mono WAV, the same shape the app's own cues have. */
function wav(samples, sr) {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * Trims the silence and fades the edges: a notification that starts with 40 ms
 * of nothing feels late, and a hard cut at the end clicks.
 */
function tidy(s, sr) {
  const quiet = 0.01;
  let first = s.findIndex((v) => Math.abs(v) > quiet);
  if (first < 0) return s;
  let last = s.length - 1;
  while (last > 0 && Math.abs(s[last]) < quiet) last--;
  // A few milliseconds either side, so the first consonant is not clipped.
  first = Math.max(0, first - Math.round(sr * 0.004));
  last = Math.min(s.length - 1, last + Math.round(sr * 0.01));
  const out = s.slice(first, last + 1);
  const fade = Math.min(Math.round(sr * 0.006), Math.floor(out.length / 4));
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[out.length - 1 - i] *= i / fade;
  }
  return out;
}

async function reachable() {
  try {
    const r = await fetch(`${ENGINE}/version`);
    return r.ok;
  } catch {
    return false;
  }
}

if (!(await reachable())) {
  console.error(
    "VOICEVOX engine is not answering on " + ENGINE + ".\n" +
    "Open VOICEVOX, wait for the engine to finish starting, then run this again.",
  );
  process.exit(1);
}

const dir = soundsFolder();
const results = [];
for (const [name, text] of CUES) {
  const q = await fetch(`${ENGINE}/audio_query?text=${encodeURIComponent(text)}&speaker=${SPEAKER}`, { method: "POST" });
  if (!q.ok) { results.push([name, text, "query failed " + q.status, ""]); continue; }
  const query = await q.json();
  // Tighter than speech: no slow start, no long tail, and it should not shout.
  query.speedScale = 1.15;
  query.prePhonemeLength = 0.05;
  query.postPhonemeLength = 0.1;
  query.volumeScale = 0.9;

  const synth = await fetch(`${ENGINE}/synthesis?speaker=${SPEAKER}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(query),
  });
  if (!synth.ok) { results.push([name, text, "synthesis failed " + synth.status, ""]); continue; }

  const { sr, s } = readWav(Buffer.from(await synth.arrayBuffer()));
  const trimmed = tidy(s, sr);
  const seconds = (trimmed.length / sr).toFixed(2) + "s";
  if (!dryRun) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.wav`), wav(trimmed, sr));
  }
  results.push([name, text, seconds, dryRun ? "(dry run)" : "written"]);
}

console.log(args["dry-run"] ? "Dry run — nothing written.\n" : `Wrote to ${dir}\n`);
for (const [name, text, extra, state] of results) {
  console.log(`  ${name.padEnd(10)} ${text.padEnd(9)} ${extra.padStart(6)}  ${state}`);
}
console.log(`\nCredit required wherever the app is presented: ${CREDIT}`);
