// Miku chibi — the Nendoroid-proportioned mascot, drawn in code on Canvas 2D.
//
// A pose is data (arm angles, eyes, mouth, an effect); `drawChibi` paints one
// frame of it at time `t`, so every pose moves: she breathes, tilts her head,
// blinks, and her twin-tails sway. The chibi is an original work, not official
// artwork (see LICENSE-ASSETS.md); the colours come from the variant.
//
// Design space is CHIBI_W × CHIBI_H, feet on y=480, centred on x=260. The
// caller scales and places it. Preview every pose at /chibi.html in dev.
//
// shortcut: the variants' `extra` painters (snowflakes, blossoms) live in the
// old 300-unit space and are not drawn here; port them when BotEngine adopts
// this drawing.

import type { BotEmoteName, BotStateName } from "../core/layout";
import type { RGB } from "./engine";
import { DEFAULT_VARIANT, MIKU_VARIANTS, type MikuVariant, type MikuVariantId } from "./variants";

export const CHIBI_W = 520;
export const CHIBI_H = 510;

type Ctx = CanvasRenderingContext2D;

/** [shoulder°, elbow°, shoulder swing°, elbow swing°, swing seconds]. 0° hangs straight down. */
type Arm = readonly [number, number, number?, number?, number?];
type Eye = "open" | "wide" | "flat" | "happy" | "closed" | "heart" | "spiral";
type Mouth = "smile" | "open" | "o" | "big" | "flat" | "wavy" | "cat" | "pout" | "sing";
type Brow = "rest" | "worry" | "angry" | "up";
type Item = "mic" | "leek" | "peace" | "glass";
type Fx =
  | "dots" | "question" | "bang" | "sweat" | "stars" | "hearts" | "lines"
  | "star" | "winkStar" | "tear" | "vein" | "notes" | "ticks" | "zzz";

interface Pose {
  L: Arm;
  R: Arm;
  eyes?: Eye | readonly [Eye, Eye];
  mouth?: Mouth;
  brows?: Brow;
  /** Where the irises point, in design units. */
  look?: readonly [number, number];
  /** The irises sweep left and right, as if reading. */
  scan?: boolean;
  /** Resting head tilt, degrees. */
  tilt?: number;
  body?: "bob" | "bounce" | "shake" | "sway";
  /** What the right hand holds. */
  hold?: Item;
  laptop?: boolean;
  fx?: Fx;
}

export type ChibiPose = BotStateName | BotEmoteName | "wave" | "singing" | "leek" | "dance";
export type ChibiEyes = Eye | readonly [Eye, Eye];

/** What a caller that animates her itself (BotEngine) hands over for one frame. */
export interface ChibiOptions {
  /** Eyes that replace the pose's own: a greeting's smile, an emote's look. */
  eyes?: ChibiEyes;
  /** Eyelids, 0 shut … 1 open. Given, it replaces her own blinking. */
  lid?: number;
  /** Added to where the pose looks, in design units. */
  look?: readonly [number, number];
  /** Head pitch, −1 chin up … 1 chin down: the face rides up and the head lifts. */
  pitch?: number;
  /** Arm rest angles [L shoulder, L elbow, R shoulder, R elbow], so poses can be blended. */
  arms?: readonly [number, number, number, number];
  /** Mini bots: the colour that tints the hair, to tell them apart. */
  tint?: RGB;
  /** Effects the caller draws itself. */
  skipFx?: ReadonlySet<string>;
  noShadow?: boolean;
}

/** One pose per app state and emote (the Record makes tsc enforce it), plus Miku's own. */
export const CHIBI_POSES: Record<ChibiPose, Pose> = {
  // States
  idle: { L: [20, 10], R: [-20, -10] },
  working: { L: [28, -40, 2, 9, 0.2], R: [-28, 40, 2, 9, 0.26], look: [0, 6], scan: true, laptop: true, fx: "ticks" },
  thinking: { L: [15, -60], R: [-20, 175, 2, 4, 2.2], look: [4, -5], mouth: "flat", tilt: -6, fx: "dots" },
  searching: { L: [25, 10], R: [-60, -60, 6, 8, 1.4], hold: "glass", look: [6, 0], mouth: "o", body: "sway" },
  approval: { L: [40, -80], R: [-100, -30, 6, 10, 0.5], mouth: "o", brows: "up", fx: "bang" },
  question: { L: [60, 70], R: [-60, -70], tilt: 8, mouth: "o", brows: "up", fx: "question" },
  error: { L: [10, 5], R: [-10, -5], body: "shake", brows: "worry", mouth: "wavy", fx: "sweat" },
  finished: { L: [110, 20, 6, 8, 0.45], R: [-110, -20, 6, 8, 0.45], body: "bounce", eyes: "happy", mouth: "open", fx: "stars" },
  ratelimit: { L: [15, 5], R: [-15, -5], eyes: "flat", brows: "worry", mouth: "wavy", fx: "sweat" },
  sleeping: { L: [12, 5, 1, 1, 3], R: [-12, -5, 1, 1, 3], eyes: "closed", mouth: "o", tilt: 10, fx: "zzz" },
  dizzy: { L: [40, 10, 8, 8, 0.5], R: [-40, -10, 8, 8, 0.5], eyes: "spiral", mouth: "wavy", body: "sway", fx: "stars" },
  // Emotes
  love: { L: [15, -70], R: [-15, 70], eyes: "heart", mouth: "open", fx: "hearts" },
  surprised: { L: [70, 0, 3, 3, 0.12], R: [-70, 0, 3, 3, 0.12], eyes: "wide", mouth: "big", brows: "up", fx: "lines" },
  proud: { L: [55, -110], R: [-55, 110], eyes: "happy", mouth: "cat", fx: "star" },
  wink: { L: [20, 10], R: [-100, -30, 6, 10, 0.6], hold: "peace", eyes: ["open", "happy"], mouth: "open", tilt: 6, fx: "winkStar" },
  yawn: { L: [15, 5], R: [-20, 175, 2, 3, 2.4], eyes: "closed", mouth: "big", fx: "tear" },
  happy: { L: [50, 10, 10, 8, 0.5], R: [-50, -10, 10, 8, 0.5], eyes: "happy", mouth: "open", body: "sway" },
  annoyed: { L: [15, -75], R: [-15, 75], eyes: "flat", brows: "angry", mouth: "pout", fx: "vein" },
  // Miku's own
  wave: { L: [20, 10], R: [-100, -30, 6, 14, 0.35], eyes: "happy", mouth: "open" },
  singing: { L: [75, 20, 10, 12, 0.8], R: [-35, 155, 2, 3, 0.8], hold: "mic", eyes: "happy", mouth: "sing", body: "sway", fx: "notes" },
  leek: { L: [20, 10], R: [-100, -30, 8, 22, 0.45], hold: "leek", mouth: "open" },
  dance: { L: [100, 30, 14, 16, 0.5], R: [-30, -20, 14, 16, 0.5], eyes: "happy", mouth: "open", body: "sway", fx: "notes" },
};

/** The arm rest angles of a pose, in the order ChibiOptions.arms takes them. */
export function chibiArms(pose: ChibiPose): [number, number, number, number] {
  const p = CHIBI_POSES[pose];
  return [p.L[0], p.L[1], p.R[0], p.R[1]];
}

// ── Colour ────────────────────────────────────────────────────────────────────

const WHITE: RGB = [1, 1, 1];
const BLACK: RGB = [0, 0, 0];
const mix = (a: RGB, b: RGB, k: number): RGB =>
  [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const css = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

/** Where the chibi's look departs from the shared palette: the figure's bluer teal and dark skirt. */
const LOOK: Partial<Record<MikuVariantId, Partial<MikuVariant>>> = {
  classic: {
    hair: [0.24, 0.71, 0.74],
    hairDark: [0.11, 0.52, 0.56],
    tie: [0.184, 0.663, 0.69],
    skirt: [0.227, 0.259, 0.322],
    skirtShade: [0.118, 0.133, 0.169],
    gloves: [0.17, 0.19, 0.24],
    headset: [0.17, 0.19, 0.24],
  },
};

function tones(v: MikuVariant) {
  return {
    hairTop: css(mix(v.hair, WHITE, 0.12)),
    hairBot: css(mix(v.hair, v.hairDark, 0.55)),
    tailTop: css(v.hair),
    tailBot: css(mix(v.hairDark, BLACK, 0.08)),
    hairBack: css(v.hairDark),
    hairDeep: css(mix(v.hairDark, BLACK, 0.2)),
    hairHi: css(mix(v.hair, WHITE, 0.5)),
    skin: css(mix(v.skin, [0.98, 0.84, 0.76], 0.5)),
    skinHi: css(mix(v.skin, WHITE, 0.3)),
    skinLo: css(mix(v.skin, [0.96, 0.8, 0.7], 0.6)),
    neck: css(mix(v.skin, [0.84, 0.62, 0.52], 0.5)),
    eyeTop: css(mix(v.eye2, BLACK, 0.25)),
    eyeMid: css(mix(v.eye1, v.eye2, 0.35)),
    eyeBot: css(mix(v.eye1, WHITE, 0.5)),
    eyeRim: css(mix(v.eye2, BLACK, 0.4)),
    pupil: css(mix(v.eye2, BLACK, 0.65), 0.9),
    ink: v.eyeInk,
    trim: css(v.tie),
    tie: css(mix(v.tie, WHITE, 0.12)),
    knot: css(mix(v.tie, BLACK, 0.18)),
    shirtHi: css(v.shirt),
    shirtLo: css(mix(v.shirt, [0.6, 0.64, 0.7], 0.85)),
    skirtTop: css(v.skirt),
    skirtBot: css(v.skirtShade),
    sleeveTop: css(mix(v.gloves, WHITE, 0.08)),
    sleeveBot: css(mix(v.gloves, BLACK, 0.3)),
    gear: css(v.headset),
    gearLo: css(mix(v.headset, BLACK, 0.4)),
    accent: v.id === "classic" ? "#F0468A" : css(v.tie),
  };
}
type Tones = ReturnType<typeof tones>;

const GOLD = "#F5C542";
const PINK = "#F0468A";
const LIP = "#C9687E";
const LIP_DARK = "#B3475F";
const STEEL = "#1E222B";

// ── Shapes (SVG path data, in design space) ───────────────────────────────────

const TAIL = "M166 96 C96 80 40 150 44 250 C46 320 70 380 60 440 C56 458 50 466 44 474 C96 462 140 410 150 330 C156 280 150 220 166 170 C172 150 178 130 180 112 Z";
const TAIL_SHADE = "M150 150 C124 210 120 300 124 372 C142 330 144 270 144 226 C144 196 146 172 150 150 Z";
const TAIL_HI = "M112 120 C72 170 64 250 76 330";
const BAND = "M-9 -30 H9 A4 4 0 0 1 13 -26 V26 A4 4 0 0 1 9 30 H-9 A4 4 0 0 1 -13 26 V-26 A4 4 0 0 1 -9 -30 Z";
const BACK_HAIR = "M146 176 C136 62 384 62 374 176 C374 240 340 298 260 298 C180 298 146 240 146 176 Z";
const BOOT = "M226 410 L258 410 L256 462 C257 474 250 480 242 480 L228 480 C219 480 219 470 226 466 Z";
const SKIRT = "M214 356 L306 356 L334 404 C300 418 220 418 186 404 Z";
const SKIRT_HEM = "M190 396 C224 410 296 410 330 396 L334 404 C300 418 220 418 186 404 Z";
const FACE = "M160 190 C160 130 360 130 360 190 C360 222 356 244 336 262 C314 280 284 288 260 288 C236 288 206 280 184 262 C164 244 160 222 160 190 Z";
const HAIR = "M262 60 C190 56 138 100 138 180 C138 226 146 262 160 300 C167 270 170 244 172 222 C174 208 176 198 180 188 L190 214 C194 198 198 188 204 180 L222 198 C226 184 230 176 236 172 C246 200 262 232 280 252 C277 226 279 196 290 170 L306 198 C312 186 320 178 326 172 L342 212 C344 198 345 192 346 186 C348 198 349 210 350 222 C352 244 354 270 362 300 C376 262 382 226 382 180 C382 100 334 56 262 60 Z";
const HAIR_STRANDS = "M262 62 C250 100 240 138 236 172 M262 62 C278 100 288 136 290 170 M262 62 C226 92 208 134 204 180 M262 62 C300 92 322 132 326 172";
const HAIR_SHINE = "M176 118 C204 84 236 72 258 70 C230 82 200 100 176 118 Z";
const MIC_BOOM = "M146 232 C150 264 168 286 192 290";
const SHIRT = "M234 294 C244 289 276 289 286 294 C290 296 292 300 292 306 L300 362 C276 370 244 370 220 362 L228 306 C228 300 230 296 234 294 Z";
const SHIRT_HEM = "M221 355 C244 363 276 363 299 355 L300 362 C276 370 244 370 220 362 Z";
const COLLARS = "M240 292 L259 301 L250 314 L236 300 Z M280 292 L261 301 L270 314 L284 300 Z";
const TIE = "M255 309 L265 309 L268 344 L260 354 L252 344 Z";
const KNOT = "M254 301 L266 301 L264 310 L256 310 Z";
const TIE_STRIPES = "M253.5 334 L266.5 334 M253 339 L267 339";
const SLEEVE = "M-9 2 L9 2 L26 44 C10 54 -10 54 -26 44 Z";
const SLEEVE_HEM = "M-24 37 C-10 46 10 46 24 37 L26 44 C10 54 -10 54 -26 44 Z";
const SCLERA = "M-23 -2 C-23 -26 23 -26 23 -2 L21 12 C18 27 -18 27 -21 12 Z";
const LASH = "M-27 -6 C-22 -30 20 -32 25 -8 C16 -22 -14 -22 -22 -8 Z M-26 -6 L-34 -13 L-23 -13 Z";
const LAPTOP = "M206 362 C206 356 210 352 216 352 L304 352 C310 352 314 356 314 362 L318 404 L202 404 Z";
const STAR = "M0 -14 L4 -4 L14 0 L4 4 L0 14 L-4 4 L-14 0 L-4 -4 Z";
const HEART = "M0 8 C-16 -6 -7 -18 0 -9 C7 -18 16 -6 0 8 Z";
const NOTE_FLAG = "M5 -14 Q18 -12 17 -2 Q12 -8 8 -8 Z";
const DROP = "M0 -20 C-8 -4 -12 4 -12 10 C-12 18 -6 24 0 24 C6 24 12 18 12 10 C12 4 8 -4 0 -20 Z";
const BROWS: Record<Brow, string> = {
  rest: "M192 194 C202 188 216 187 226 190 M294 190 C304 187 318 188 328 194",
  worry: "M192 197 L226 187 M294 187 L328 197",
  angry: "M192 186 L226 196 M294 196 L328 186",
  up: "M192 188 C202 181 216 180 226 184 M294 184 C304 180 318 181 328 188",
};

// Path2D is built on first use: the module must load where there is no canvas.
const paths = new Map<string, Path2D>();
function path(d: string): Path2D {
  let p = paths.get(d);
  if (!p) paths.set(d, (p = new Path2D(d)));
  return p;
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

const rad = (deg: number) => (deg * Math.PI) / 180;
/** −1 → 1 → −1, easing at both ends: one way takes `dur` seconds. */
const wave = (t: number, dur: number, delay = 0) => -Math.cos((Math.PI * (t - delay)) / dur);
/** The same swing, 0 → 1 → 0. */
const unit = (t: number, dur: number, delay = 0) => (wave(t, dur, delay) + 1) / 2;

function fill(x: Ctx, d: string, style: string | CanvasGradient, alpha = 1) {
  x.globalAlpha = alpha;
  x.fillStyle = style;
  x.fill(path(d));
  x.globalAlpha = 1;
}
function stroke(x: Ctx, d: string, color: string, width: number, alpha = 1) {
  x.globalAlpha = alpha;
  x.strokeStyle = color;
  x.lineWidth = width;
  x.lineCap = "round";
  x.lineJoin = "round";
  x.stroke(path(d));
  x.globalAlpha = 1;
}
function line(x: Ctx, x0: number, y0: number, x1: number, y1: number, color: string, width: number) {
  x.strokeStyle = color;
  x.lineWidth = width;
  x.lineCap = "round";
  x.beginPath();
  x.moveTo(x0, y0);
  x.lineTo(x1, y1);
  x.stroke();
}
function oval(x: Ctx, cx: number, cy: number, rx: number, ry: number, style: string | CanvasGradient) {
  x.fillStyle = style;
  x.beginPath();
  x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  x.fill();
}
function rect(x: Ctx, rx: number, ry: number, w: number, h: number, style: string) {
  x.fillStyle = style;
  x.fillRect(rx, ry, w, h);
}
/** A top-to-bottom gradient between two heights. */
function lin(x: Ctx, y0: number, y1: number, ...stops: string[]) {
  const g = x.createLinearGradient(0, y0, 0, y1);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  return g;
}
/** Draw `fn` moved to (tx, ty), turned and scaled. */
function at(x: Ctx, tx: number, ty: number, fn: () => void, deg = 0, sx = 1, sy = sx, alpha = 1) {
  x.save();
  x.translate(tx, ty);
  if (deg) x.rotate(rad(deg));
  if (sx !== 1 || sy !== 1) x.scale(sx, sy);
  const before = x.globalAlpha;
  x.globalAlpha = before * alpha;
  fn();
  x.globalAlpha = before;
  x.restore();
}
/** Draw `fn` turned around (px, py). */
function spin(x: Ctx, px: number, py: number, deg: number, fn: () => void) {
  x.save();
  x.translate(px, py);
  x.rotate(rad(deg));
  x.translate(-px, -py);
  fn();
  x.restore();
}
/** Draw `fn` mirrored left-to-right across the figure's centre line. */
function mirror(x: Ctx, fn: () => void) {
  x.save();
  x.translate(CHIBI_W, 0);
  x.scale(-1, 1);
  fn();
  x.restore();
}

// ── Parts ─────────────────────────────────────────────────────────────────────

function tail(x: Ctx, c: Tones, t: number, delay: number) {
  spin(x, 170, 100, 1 + 3 * wave(t, 2, delay), () => {
    fill(x, TAIL, lin(x, 96, 474, c.tailTop, c.tailBot));
    fill(x, TAIL_SHADE, c.hairDeep, 0.5);
    stroke(x, TAIL_HI, c.hairHi, 7, 0.55);
  });
}

function hairBack(x: Ctx, c: Tones, t: number) {
  tail(x, c, t, 0);
  mirror(x, () => tail(x, c, t, 0.7));
  for (const [bx, deg] of [[172, -20], [348, 20]] as const) {
    at(x, bx, 84, () => {
      fill(x, BAND, lin(x, -30, 30, c.gear, c.gearLo));
      rect(x, -9, -30, 6, 60, c.accent);
    }, deg);
  }
  fill(x, BACK_HAIR, c.hairBack);
}

function lower(x: Ctx, c: Tones) {
  const leg = () => at(x, -4, 0, () => {
    rect(x, 228, 396, 28, 20, c.skinLo);
    fill(x, BOOT, lin(x, 410, 480, c.sleeveTop, c.sleeveBot));
    rect(x, 226, 410, 32, 7, c.trim);
  });
  leg();
  mirror(x, leg);
  rect(x, 250, 278, 20, 20, c.neck);
  fill(x, SKIRT, lin(x, 356, 412, c.skirtTop, c.skirtBot));
  fill(x, SKIRT_HEM, c.trim);
}

function eye(x: Ctx, cx: number, flip: 1 | -1, kind: Eye, p: Pose, t: number, c: Tones, lidGiven?: number) {
  if (kind === "happy" || kind === "closed") {
    const up = kind === "happy";
    x.strokeStyle = c.ink;
    x.lineWidth = 5.5;
    x.lineCap = "round";
    x.beginPath();
    x.moveTo(cx - 21, up ? 236 : 230);
    x.quadraticCurveTo(cx, up ? 208 : 242, cx + 21, up ? 236 : 230);
    x.stroke();
    return;
  }
  if (kind === "heart") {
    at(x, cx, 232, () => fill(x, HEART, PINK), 0, 1.6 + 0.7 * unit(t, 0.5));
    return;
  }
  if (kind === "spiral") {
    at(x, cx, 230, () => {
      x.strokeStyle = c.ink;
      x.lineWidth = 4;
      x.lineCap = "round";
      x.beginPath();
      for (let a = 0; a <= Math.PI * 5; a += 0.3) x.lineTo(Math.cos(a) * a * 1.3, Math.sin(a) * a * 1.3);
      x.stroke();
    }, t * 280 * flip);
    return;
  }
  // An open eye. It blinks once every four seconds.
  const phase = (t % 4) / 4;
  const lid = lidGiven !== undefined
    ? Math.max(0.08, Math.min(1, lidGiven))
    : phase > 0.92 ? Math.max(0.08, 1 - Math.sin((Math.PI * (phase - 0.92)) / 0.08)) : 1;
  const s = kind === "wide" ? 0.7 : 1;
  const ox = (p.look?.[0] ?? 0) + (p.scan ? 5 * wave(t, 1.6) : 0);
  const oy = p.look?.[1] ?? 0;
  x.save();
  x.translate(0, 232);
  x.scale(1, lid);
  x.translate(0, -232);
  at(x, cx, 228, () => fill(x, SCLERA, "#FFFFFF"), 0, flip, 1);
  at(x, cx + ox, 228 + oy, () => {
    oval(x, 1, 3, 17, 20, lin(x, -17, 23, c.eyeTop, c.eyeMid, c.eyeBot));
    x.strokeStyle = c.eyeRim;
    x.lineWidth = 2;
    x.stroke();
    oval(x, 1, 5, 8, 11, c.pupil);
  }, 0, flip * s, s);
  oval(x, cx - 7 + ox, 219 + oy, 6.5 * s, 6.5 * s, "#FFFFFF");
  oval(x, cx + 8 + ox, 241 + oy, 3 * s, 3 * s, "#FFFFFF");
  at(x, cx, 228, () => fill(x, LASH, c.ink), 0, flip, 1);
  if (kind === "flat") {
    // A heavy lid: skin over the top half, and its edge.
    rect(x, cx - 30, 196, 60, 30, c.skinHi);
    line(x, cx - 24, 226, cx + 24, 226, c.ink, 5.5);
  }
  x.restore();
}

function mouth(x: Ctx, kind: Mouth, t: number) {
  const curve = (d: string) => stroke(x, d, LIP, 2.5);
  switch (kind) {
    case "smile": return curve("M251 265 Q260 272 269 265");
    case "open": return fill(x, "M250 262 C253 277 267 277 270 262 Z", LIP);
    case "o": return oval(x, 260, 267, 4.5, 4.5, LIP);
    case "big": return oval(x, 260, 268, 8, 10, LIP_DARK);
    case "flat": return curve("M254 267 L266 267");
    case "wavy": return curve("M250 268 Q255 262 260 268 Q265 274 270 268");
    case "cat": return curve("M250 264 Q255 272 260 264 Q265 272 270 264");
    case "pout": return curve("M252 270 Q260 263 268 270");
    case "sing": return oval(x, 260, 267, 7, 9 * (0.45 + 0.65 * unit(t, 0.3)), LIP_DARK);
  }
}

function head(x: Ctx, p: Pose, t: number, c: Tones, lid?: number, faceDy = 0) {
  const skin = x.createRadialGradient(260, 209, 0, 260, 209, 124);
  skin.addColorStop(0, c.skinHi);
  skin.addColorStop(1, c.skinLo);
  fill(x, FACE, skin);
  x.save();
  x.translate(0, faceDy);
  for (const bx of [186, 334]) {
    const blush = x.createRadialGradient(bx, 258, 0, bx, 258, 20);
    blush.addColorStop(0, "rgba(255,157,174,0.45)");
    blush.addColorStop(1, "rgba(255,157,174,0)");
    oval(x, bx, 258, 20, 20, blush);
  }
  const kinds = p.eyes ?? "open";
  const [left, right] = typeof kinds === "string" ? [kinds, kinds] : kinds;
  eye(x, 212, 1, left, p, t, c, lid);
  eye(x, 308, -1, right, p, t, c, lid);
  mouth(x, p.mouth ?? "smile", t);
  x.restore();

  fill(x, HAIR, lin(x, 60, 300, c.hairTop, c.hairBot));
  stroke(x, HAIR_STRANDS, c.hairBack, 2.5, 0.5);
  fill(x, HAIR_SHINE, "#FFFFFF", 0.4);
  stroke(x, BROWS[p.brows ?? "rest"], c.hairDeep, 2.5);

  // Headset: an ear cup each side, the boom and its mic on her right.
  for (const hx of [144, 376]) {
    line(x, hx, 204, hx, 224, c.gear, 16);
    line(x, hx + (hx < 260 ? -4 : 4), 210, hx + (hx < 260 ? -4 : 4), 218, c.accent, 4);
  }
  stroke(x, MIC_BOOM, c.gearLo, 3);
  line(x, 193, 289, 199, 289, c.gearLo, 10);
}

function shirt(x: Ctx, c: Tones) {
  const g = x.createLinearGradient(220, 290, 300, 370);
  g.addColorStop(0, c.shirtLo);
  g.addColorStop(0.45, c.shirtHi);
  g.addColorStop(1, c.shirtLo);
  fill(x, SHIRT, g);
  fill(x, SHIRT_HEM, c.trim);
  fill(x, COLLARS, c.trim);
  fill(x, TIE, c.tie);
  fill(x, KNOT, c.knot);
  stroke(x, TIE_STRIPES, c.sleeveBot, 2.2);
  rect(x, 273, 320, 14, 6, "#D8D24A");
}

function held(x: Ctx, item: Item, c: Tones) {
  switch (item) {
    case "mic":
      rect(x, -4, 48, 8, 14, STEEL);
      oval(x, 0, 67, 8, 8, "#C9CFD8");
      rect(x, -8, 60, 16, 3, STEEL);
      return;
    case "leek":
      line(x, 0, 46, 0, 108, "#F4F7E8", 9);
      for (const lx of [-11, 0, 12]) line(x, 0, 104, lx, lx ? 150 : 158, "#6BBF4A", 8);
      return;
    case "peace":
      line(x, -3, 58, -9, 76, c.skin, 6);
      line(x, 3, 58, 9, 76, c.skin, 6);
      return;
    case "glass":
      line(x, 0, 54, 0, 72, STEEL, 6);
      oval(x, 0, 92, 20, 20, "rgba(223,246,250,0.7)");
      x.strokeStyle = STEEL;
      x.lineWidth = 5;
      x.stroke();
      return;
  }
}

/** One arm, in two passes: the upper arm goes under the shirt, the forearm over it. */
function arm(x: Ctx, side: -1 | 1, a: Arm, t: number, c: Tones, part: "upper" | "fore", item?: Item) {
  const [shoulder, elbow, ds = 3, de = 4, dur = 1.8] = a;
  const w = wave(t, dur);
  at(x, side < 0 ? 233 : 287, 305, () => {
    if (part === "upper") return line(x, 0, 0, 0, 22, c.skin, 16);
    at(x, 0, 22, () => {
      if (item) held(x, item, c);
      oval(x, 0, 0, 8, 8, c.skin);
      oval(x, 0, 54, 9, 8, c.skin);
      fill(x, SLEEVE, lin(x, 2, 54, c.sleeveTop, c.sleeveBot));
      rect(x, -9, 1, 18, 5, c.trim);
      fill(x, SLEEVE_HEM, c.trim);
    }, elbow + de * w);
  }, shoulder + ds * w);
}

function laptop(x: Ctx) {
  fill(x, LAPTOP, lin(x, 352, 404, "#E3E7EC", "#B4BCC7"));
  oval(x, 260, 378, 10, 10, "#2FA9B0");
  stroke(x, "M255 378 L259 382 L266 374", "#FFFFFF", 2.5);
  line(x, 197, 407, 323, 407, "#8E97A3", 10);
}

// ── Effects ───────────────────────────────────────────────────────────────────

/** Something that floats up and fades, forever. */
function rise(x: Ctx, px: number, py: number, t: number, delay: number, fn: () => void, dur = 2) {
  const k = ((((t - delay) / dur) % 1) + 1) % 1;
  at(x, px, py + 12 - 56 * k, fn, 0, 1, 1, k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8);
}
/** Something that twinkles in place. */
function twinkle(x: Ctx, px: number, py: number, t: number, delay: number, fn: () => void, dur = 0.6, size = 1) {
  const k = unit(t, dur, delay);
  at(x, px, py, fn, 0, size * (0.5 + 0.6 * k), size * (0.5 + 0.6 * k), 0.2 + 0.8 * k);
}
const pulse = (t: number) => 0.8 + 0.35 * unit(t, 0.5);

function effect(x: Ctx, fx: Fx, t: number) {
  const star = () => fill(x, STAR, GOLD);
  const heart = () => fill(x, HEART, PINK);
  const note = () => {
    oval(x, 0, 10, 7, 5, PINK);
    rect(x, 5, -14, 3, 24, PINK);
    fill(x, NOTE_FLAG, PINK);
  };
  const drop = (px: number, py: number, dur: number, fn: () => void) => {
    const k = (t / dur) % 1;
    at(x, px, py + 28 * k, fn, 0, 1, 1, 1 - k);
  };
  switch (fx) {
    case "dots":
      for (let i = 0; i < 3; i++) twinkle(x, 404 + i * 27, 70 - i * 20, t, i * 0.3, () => oval(x, 0, 0, 7 + i * 3.5, 7 + i * 3.5, "#9FE6E6"), 0.9);
      return;
    case "question":
      at(x, 436, 62 - 5 * unit(t, 1.6), () => {
        stroke(x, "M-17 -18 C-17 -40 17 -40 17 -16 C17 0 0 0 0 16", GOLD, 9);
        oval(x, 0, 36, 6, 6, GOLD);
      });
      return;
    case "bang":
      at(x, 440, 70, () => {
        line(x, 0, -34, 0, 0, GOLD, 12);
        oval(x, 0, 24, 7, 7, GOLD);
      }, 0, pulse(t));
      return;
    case "sweat":
      drop(352, 150, 1.2, () => {
        fill(x, DROP, "#E4F7FF");
        stroke(x, DROP, "#7CC4E8", 2);
      });
      return;
    case "stars":
      twinkle(x, 96, 60, t, 0, star);
      twinkle(x, 430, 48, t, 0.2, star, 0.6, 1.3);
      twinkle(x, 260, 30, t, 0.4, star, 0.6, 0.8);
      return;
    case "hearts":
      rise(x, 110, 90, t, 0, heart);
      rise(x, 410, 80, t, 0.7, heart);
      rise(x, 260, 50, t, 1.3, heart);
      return;
    case "lines":
      at(x, 430, 80, () => stroke(x, "M0 -34 L0 -12 M26 -22 L12 -6 M34 6 L14 6", GOLD, 7), 0, pulse(t));
      return;
    case "star":
      twinkle(x, 420, 70, t, 0, star, 0.6, 1.4);
      return;
    case "winkStar":
      twinkle(x, 366, 208, t, 0, star, 0.6, 0.9);
      return;
    case "tear":
      drop(336, 244, 2.4, () => {
        oval(x, 0, 0, 5, 5, "#E4F7FF");
        x.strokeStyle = "#7CC4E8";
        x.lineWidth = 1.5;
        x.stroke();
      });
      return;
    case "vein":
      at(x, 352, 124, () => stroke(x, "M-10 -4 Q-4 -4 -4 -10 M4 -10 Q4 -4 10 -4 M10 4 Q4 4 4 10 M-4 10 Q-4 4 -10 4", "#E0354F", 4), 0, pulse(t));
      return;
    case "notes":
      rise(x, 100, 90, t, 0, note);
      rise(x, 424, 84, t, 0.6, note);
      rise(x, 64, 180, t, 1.2, note);
      return;
    case "ticks": {
      const tick = (px: number, py: number, dx: number, dy: number, delay: number) =>
        twinkle(x, px, py, t, delay, () => line(x, 0, 0, dx, dy, GOLD, 6), 0.25);
      tick(186, 350, -12, -10, 0);
      tick(176, 372, -14, 0, 0.12);
      tick(334, 350, 12, -10, 0.06);
      tick(344, 372, 14, 0, 0.18);
      return;
    }
    case "zzz":
      for (let i = 0; i < 3; i++) {
        rise(x, 400 + i * 22, 110 - i * 26, t, i * 0.9, () => stroke(x, "M-8 -8 H8 L-8 8 H8", "#9FE6E6", 4), 2.7);
      }
      return;
  }
}

// ── The frame ─────────────────────────────────────────────────────────────────

/**
 * Paint one frame of `pose` at time `t` (seconds), in design space: the caller
 * scales the context so CHIBI_W × CHIBI_H lands where it wants her.
 */
export function drawChibi(
  x: Ctx,
  pose: ChibiPose,
  t: number,
  variant: MikuVariantId = DEFAULT_VARIANT,
  o: ChibiOptions = {},
) {
  const base = CHIBI_POSES[pose];
  const p: Pose = {
    ...base,
    eyes: o.eyes ?? base.eyes,
    look: o.look ? [(base.look?.[0] ?? 0) + o.look[0], (base.look?.[1] ?? 0) + o.look[1]] : base.look,
    L: o.arms ? [o.arms[0], o.arms[1], base.L[2], base.L[3], base.L[4]] : base.L,
    R: o.arms ? [o.arms[2], o.arms[3], base.R[2], base.R[3], base.R[4]] : base.R,
  };
  const v = { ...MIKU_VARIANTS[variant], ...LOOK[variant] };
  if (o.tint) {
    v.hair = mix(v.hair, o.tint, 0.62);
    v.hairDark = mix(v.hairDark, o.tint, 0.62);
  }
  const c = tones(v);

  // Her shadow stays on the floor while she moves.
  if (!o.noShadow) oval(x, 260, 484, 92, 8, "rgba(0,0,0,0.14)");

  x.save();
  switch (p.body ?? "bob") {
    case "bob": x.translate(0, -5 * unit(t, 1.6)); break;
    case "bounce": x.translate(0, -18 * unit(t, 0.4)); break;
    case "shake": x.translate(4 * wave(t, 0.1), 0); break;
    case "sway":
      x.translate(260, 480);
      x.rotate(rad(4 * wave(t, 1)));
      x.translate(-260, -480);
      break;
  }
  const tilt = (p.tilt ?? 0) + 2 * wave(t, 2.6);
  // Looking up: the head lifts off the neck a little and the face slides up under the bangs.
  const up = Math.max(-1, Math.min(1, -(o.pitch ?? 0)));
  spin(x, 260, 288 + 3 * up, tilt, () => { x.translate(0, -3 * up); hairBack(x, c, t); });
  lower(x, c);
  spin(x, 260, 288 + 3 * up, tilt, () => { x.translate(0, -3 * up); head(x, p, t, c, o.lid, -7 * up); });
  arm(x, -1, p.L, t, c, "upper");
  arm(x, 1, p.R, t, c, "upper");
  shirt(x, c);
  arm(x, -1, p.L, t, c, "fore");
  arm(x, 1, p.R, t, c, "fore", p.hold);
  if (p.laptop) laptop(x);
  if (p.fx && !o.skipFx?.has(p.fx)) effect(x, p.fx, t);
  x.restore();
}
