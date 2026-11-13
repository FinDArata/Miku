// Composes the 30 Kanon sounds as WAVs — the set is generated, like the icons
// (gen-icons.mjs), so the repository carries no composed audio. Two styles,
// both built:
//
//   chimes — musical: soft bell arpeggios, the brand's own "kanon" (花音)
//   pop    — Mochi-like: bubbly sine pops and chirps
//   mix    — default: chimes for the big moments, pop for the light and negative ones
//
//   node scripts/gen-sounds.mjs [--style=chimes|pop|mix] [--out=<dir>]
//
// Output: 22.05 kHz, 16-bit mono WAVs, each under a second. The chimes are
// quiet and sit under 1 kHz, so the lower rate is inaudible and the files are
// half the size — the installer carries 30 of them.
//
// Six of the 30 are then replaced by the spoken cues in ../voice/ (see
// scripts/voice-cues.mjs): a neural voice cannot be composed in code, so those
// are recorded once and committed. They are laid over the chimes here, which is
// what makes a fresh clone — and a release build — carry them with no extra
// step. A file of the user's own in the sounds folder still wins over both.

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 22050;
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v = ""] = a.replace(/^--/, "").split("=");
  return [k, v];
}));
const style = args.style ?? "mix";
const OUT = args.out ?? join(dirname(fileURLToPath(import.meta.url)), "..", "sounds");

// ── note helper: semitones from C4 ────────────────────────────────────────────
const N = st => 261.63 * Math.pow(2, st / 12);

// ── sample helpers (float -1..1) ──────────────────────────────────────────────
const sec = s => Math.round(s * SR);
const buf = d => new Float32Array(sec(d));

function tone(b, f, t0, dur, { type = "tri", vol = 0.22, slideTo = 0 } = {}) {
  const s = sec(t0), n = sec(dur), ph = 2 * Math.PI * f / SR;
  const dph = slideTo ? (2 * Math.PI * (slideTo - f) / SR) / n : 0;
  for (let i = 0; i < n && s + i < b.length; i++) {
    const p = ph * i + dph * i * i / 2;
    const w = type === "tri" ? (2 / Math.PI) * Math.asin(Math.sin(p))
            : type === "sq" ? Math.sign(Math.sin(p)) : Math.sin(p);
    const env = Math.min(1, i / sec(0.012)) * Math.exp(-3.2 * i / n);
    b[s + i] += w * vol * env;
  }
}
function pop(b, f0 = 520, f1 = 180, t0 = 0, dur = 0.09, vol = 0.3) {
  const s = sec(t0), n = sec(dur);
  for (let i = 0; i < n && s + i < b.length; i++) {
    const f = f0 * Math.pow(f1 / f0, i / n);
    b[s + i] += Math.sin(2 * Math.PI * f * i / SR) * vol * Math.exp(-6 * i / n);
  }
}

// ── style A: chimes (musical) ─────────────────────────────────────────────────
const chimes = {
  finish:   b => [0, 4, 7, 12].forEach((st, i) => tone(b, N(24 + st), i * 0.085, 0.5)),
  greeting: b => { tone(b, N(19), 0, 0.22); tone(b, N(16), 0.16, 0.34, { vol: 0.18 }); },
  greet:    b => { tone(b, N(19), 0, 0.18); tone(b, N(24), 0.14, 0.3, { vol: 0.18 }); },
  approval: b => [0, 4, 7].forEach((st, i) => tone(b, N(24 + st), i * 0.045, 0.7, { vol: 0.16 })),
  approve:  b => [0, 7, 12].forEach((st, i) => tone(b, N(24 + st), i * 0.045, 0.6, { vol: 0.15 })),
  question: b => { tone(b, N(16), 0, 0.16); tone(b, N(21), 0.14, 0.3, { vol: 0.2 }); },
  error:    b => { tone(b, 208, 0, 0.24, { type: "sq", vol: 0.1 }); tone(b, 221, 0, 0.24, { type: "sq", vol: 0.1 });
                   tone(b, 208, 0.26, 0.2, { type: "sq", vol: 0.08 }); },
  dizzy:    b => { tone(b, N(16), 0, 0.5, { slideTo: N(7) }); tone(b, N(21), 0.1, 0.5, { vol: 0.13, slideTo: N(10) }); },
  love:     b => [0, 4, 9].forEach((st, i) => tone(b, N(24 + st), i * 0.05, 0.55, { vol: 0.15 })),
  proud:    b => [0, 7, 12].forEach((st, i) => tone(b, N(24 + st), i * 0.06, 0.55, { vol: 0.16 })),
  wink:     b => { tone(b, N(28), 0, 0.12, { vol: 0.18 }); tone(b, N(31), 0.09, 0.2, { vol: 0.15 }); },
  work:     b => { tone(b, N(24), 0, 0.1, { vol: 0.14 }); tone(b, N(28), 0.16, 0.12, { vol: 0.13 }); },
  think:    b => tone(b, N(17), 0, 0.3, { vol: 0.14 }),
  search:   b => [0, 2, 4, 7].forEach((st, i) => tone(b, N(24 + st), i * 0.055, 0.16, { vol: 0.14 })),
  rate:     b => { tone(b, N(21), 0, 0.14, { vol: 0.16 }); tone(b, N(24), 0.12, 0.2, { vol: 0.14 }); },
  send:     b => tone(b, N(36), 0, 0.18, { vol: 0.2 }),
  tick:     b => tone(b, N(28), 0, 0.07, { vol: 0.14 }),
  blip:     b => tone(b, N(31), 0, 0.08, { vol: 0.15 }),
  hover:    b => tone(b, N(24), 0, 0.05, { vol: 0.12 }),
  peek:     b => { tone(b, N(28), 0, 0.1, { vol: 0.15 }); tone(b, N(31), 0.08, 0.14, { vol: 0.13 }); },
  open:     b => { tone(b, N(12), 0, 0.12, { vol: 0.16 }); tone(b, N(19), 0.1, 0.2, { vol: 0.15 }); },
  close:    b => { tone(b, N(19), 0, 0.12, { vol: 0.16 }); tone(b, N(12), 0.1, 0.2, { vol: 0.15 }); },
  attach:   b => [0, 4].forEach(st => tone(b, N(24 + st), 0, 0.25, { vol: 0.14 })),
  slap:     b => tone(b, 150, 0, 0.09, { type: "sq", vol: 0.16 }),
  annoyed:  b => { tone(b, 185, 0, 0.12, { type: "sq", vol: 0.12 }); tone(b, 196, 0.13, 0.14, { type: "sq", vol: 0.12 }); },
  gulp:     b => tone(b, 400, 0, 0.16, { slideTo: 90, vol: 0.24 }),
  pop:      b => pop(b, 520, 180, 0, 0.09, 0.3),
  sleep:    b => [12, 7, 4].forEach((st, i) => tone(b, N(12 + st), i * 0.22, 0.4, { vol: 0.12 })),
  yawn:     b => tone(b, 300, 0, 0.6, { slideTo: 175, vol: 0.16 }),
};

// ── style B: soft pop (Mochi-like) ────────────────────────────────────────────
const pops = {
  finish:   b => { pop(b, 520, 180, 0, 0.09, 0.3); tone(b, N(31), 0.1, 0.25, { slideTo: N(31) + 120, vol: 0.2 }); },
  greeting: b => { pop(b, 420, 260, 0, 0.08, 0.26); pop(b, 380, 240, 0.12, 0.08, 0.22); },
  greet:    b => { pop(b, 440, 280, 0, 0.08, 0.26); pop(b, 500, 320, 0.11, 0.08, 0.22); },
  approval: b => { pop(b, 560, 260, 0, 0.08, 0.28); tone(b, N(34), 0.1, 0.24, { vol: 0.16 }); },
  approve:  b => { pop(b, 500, 240, 0, 0.08, 0.26); tone(b, N(29), 0.1, 0.22, { vol: 0.15 }); },
  question: b => tone(b, N(24), 0, 0.16, { slideTo: N(24) + 160, vol: 0.22 }),
  error:    b => { pop(b, 300, 140, 0, 0.1, 0.3); pop(b, 240, 110, 0.14, 0.12, 0.3); },
  dizzy:    b => { pop(b, 500, 200, 0, 0.12, 0.26); pop(b, 380, 150, 0.12, 0.12, 0.24); pop(b, 300, 120, 0.24, 0.14, 0.2); },
  love:     b => { pop(b, 460, 240, 0, 0.09, 0.26); tone(b, N(28), 0.12, 0.3, { vol: 0.18 }); },
  proud:    b => { pop(b, 520, 200, 0, 0.1, 0.28); tone(b, N(36), 0.14, 0.24, { vol: 0.16 }); },
  wink:     b => { pop(b, 700, 500, 0, 0.05, 0.22); tone(b, N(34), 0.06, 0.16, { vol: 0.16 }); },
  work:     b => { pop(b, 600, 460, 0, 0.04, 0.2); pop(b, 600, 460, 0.16, 0.04, 0.18); },
  think:    b => pop(b, 380, 300, 0, 0.12, 0.2),
  search:   b => [0, 0.06, 0.12].forEach((t, i) => pop(b, 400 + i * 90, 260 + i * 70, t, 0.05, 0.18)),
  rate:     b => { pop(b, 560, 420, 0, 0.05, 0.2); pop(b, 560, 420, 0.1, 0.05, 0.18); },
  send:     b => pop(b, 900, 700, 0, 0.035, 0.22),
  tick:     b => pop(b, 1000, 800, 0, 0.025, 0.18),
  blip:     b => pop(b, 800, 640, 0, 0.03, 0.2),
  hover:    b => pop(b, 700, 600, 0, 0.02, 0.14),
  peek:     b => { pop(b, 620, 480, 0, 0.04, 0.18); pop(b, 700, 560, 0.07, 0.04, 0.16); },
  open:     b => { pop(b, 380, 520, 0, 0.07, 0.24); },
  close:    b => { pop(b, 520, 340, 0, 0.07, 0.24); },
  attach:   b => { pop(b, 460, 300, 0, 0.07, 0.24); pop(b, 560, 360, 0.09, 0.07, 0.2); },
  slap:     b => pop(b, 220, 90, 0, 0.08, 0.32),
  annoyed:  b => { pop(b, 260, 130, 0, 0.09, 0.28); pop(b, 240, 120, 0.12, 0.1, 0.26); },
  gulp:     b => pop(b, 420, 80, 0, 0.15, 0.3),
  pop:      b => pop(b, 560, 170, 0, 0.1, 0.32),
  sleep:    b => [0, 0.24, 0.48].forEach((t, i) => pop(b, 340 - i * 60, 200 - i * 40, t, 0.14, 0.16)),
  yawn:     b => tone(b, 300, 0, 0.6, { slideTo: 175, vol: 0.16 }),
};

// Changing slides: two glassy notes a fifth apart (E5 → B5), a music box
// turning a page. Sine plus a soft octave partial that fades faster.
function bell(b, f, t0, dur, vol) {
  const s = sec(t0), n = sec(dur);
  for (let i = 0; i < n && s + i < b.length; i++) {
    const t = i / SR;
    const env = Math.min(1, i / sec(0.004)) * Math.exp(-t * 7 / dur);
    b[s + i] += vol * env * (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 18));
  }
}
const slide = b => { bell(b, N(28), 0, 0.28, 0.16); bell(b, N(35), 0.06, 0.34, 0.14); };
chimes.slide = pops.slide = slide;

// ── mix: chimes untuk momen penting, pop untuk yang ringan/negatif ────────────
const MIX_CHIMES = new Set(["finish", "greeting", "greet", "approval", "approve", "question",
  "proud", "love", "think", "work", "sleep", "yawn", "search"]);
const pick = name => style === "chimes" ? chimes[name]
  : style === "pop" ? pops[name]
  : (MIX_CHIMES.has(name) ? chimes[name] : pops[name]);

const NAMES = ["peek", "open", "close", "hover", "blip", "slap", "annoyed", "dizzy", "greet",
  "work", "finish", "error", "approval", "question", "approve", "gulp", "tick", "send",
  "love", "pop", "proud", "wink", "yawn", "attach", "think", "search", "rate", "sleep",
  "greeting", "slide"];

function wav(samples) {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const name of NAMES) {
  const b = buf(0.9);
  (pick(name))(b);
  writeFileSync(join(OUT, `${name}.wav`), wav(b));
  total++;
}

// The spoken cues, laid over the chimes they stand in for. Missing folder or
// missing file is not an error: a checkout without them simply keeps the
// chimes, which is what every build did before they existed.
const VOICE = join(dirname(fileURLToPath(import.meta.url)), "..", "voice");
let voiced = 0;
if (existsSync(VOICE)) {
  for (const file of readdirSync(VOICE)) {
    if (extname(file) !== ".wav") continue;
    copyFileSync(join(VOICE, file), join(OUT, file));
    voiced++;
  }
}

console.log(`wrote ${total} ${style} WAVs -> ${OUT}`);
if (voiced > 0) console.log(`laid ${voiced} spoken cue(s) from ${VOICE} over them`);
