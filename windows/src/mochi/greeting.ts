// The launch greeting, "Live Stage": Miku comes up through the stage floor on a
// lift, under her spotlight, while the footlights sweep on. She raises her hand
// to the crowd, notes (snowflakes for Snow, petals for Sakura) drift around her
// and her name lights up karaoke-style beside her. Then a small bow, one pulse of
// the footlights, and she settles in the compact island.
// Everything is laid out in the 640×150 reference space the island uses.

import { closeCurve } from "../core/anim";
import { Sound } from "../core/sound";
import { COMPACT_W, NOTCH_H, NOTCH_W } from "../core/layout";
import { BotEngine } from "./engine";
import { petal, snowflake, type MikuVariantId } from "./variants";

// ── Timing ────────────────────────────────────────────────────────────────────

const T = {
  sweep0: 0.08,
  sweep1: 0.55,
  rise0: 0.42,
  rise1: 1.0,
  pop0: 1.02,
  pop1: 1.12,
  lyric0: 1.35,
  lyric1: 2.15,
  notes0: 1.1,
  notes1: 2.3,
  tuck0: 2.3,
  tuck1: 2.55,
  badge: 2.57,
  bow0: 2.6,
  bow1: 3.0,
  tint0: 2.75,
  tint1: 3.05,
  pulse0: 2.95,
  pulse1: 3.35,
  end: 3.45,
  autoLeave: 3.75,
  COLLAPSE: 0.34,
};

export const GREETING_END = T.end;

/** The greeting's own sound, played from the start (sounds/greeting.wav). */
const GREETING_SOUND = "greeting";

// ── The day's hello ───────────────────────────────────────────────────────────

/** Which signature move she greets with, in the wave's own window. */
export type GreetSignature = "wave" | "bow" | "twirl";

/**
 * Stable per day: the same hello all day, a different one tomorrow. `day` is
 * any day-ordinal (year*372 + month*31 + date does fine).
 */
export function greetSignature(day: number): GreetSignature {
  return (["wave", "bow", "twirl"] as const)[((day % 3) + 3) % 3];
}

/** Today as a day-ordinal, for greetSignature. */
export function todayNumber(d = new Date()): number {
  return d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
}

// ── Geometry (640×150) ────────────────────────────────────────────────────────

export const GREETING_W = 640;
export const GREETING_H = 150;
const C0 = { x: 320, y: 90 };
const HB = 70;
/** How much squash and stretch the chibi keeps: she is a figure, not a blob. */
const SQUASH = 0.45;
export const ASP = 1.34;
const EAR_X = 40;
const EAR_HB = 17;
const CARD = { x: 10, y: 36, w: 620, h: 104 };
const CARD_R = 20;
/** The stage floor: she is clipped here while the lift brings her up. */
export const FLOOR = 138;
/** Her box is `HB / 0.6` tall; the figure reaches 31 % of it below her centre. */
const HALF_FIG = (HB / 0.6) * 0.31;
/** Where the lift starts: her head just under the floor. */
const LIFT_Y = FLOOR + HALF_FIG + 2;
const LYRIC = { x: 372, y: 100, text: "Miku", font: '800 34px system-ui, "Segoe UI Variable Text", "Segoe UI", sans-serif' };

/** IslandRestingLayout for the compact island the greeting lands in. */
const COMPACT = {
  width: COMPACT_W,
  height: NOTCH_H,
  botDiameter: Math.min(20, Math.max(0, NOTCH_H - 6)),
  botCenterY: NOTCH_H / 2,
};

/** Stage light colour per Miku: her hair, except Snow's white hair, lit ice-blue. */
const STAGE: Record<MikuVariantId, readonly [number, number, number]> = {
  classic: [57, 197, 187],
  snow: [127, 184, 240],
  sakura: [245, 168, 199],
};

// ── Easing ────────────────────────────────────────────────────────────────────

const E = {
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  easeIn: (t: number) => t * t * t,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
const bump = (t: number, a: number, b: number) => (t >= a && t < b ? Math.sin(Math.PI * seg(t, a, b)) : 0);

// ── Pose ──────────────────────────────────────────────────────────────────────

type EyeType = "dot" | "happy" | "content";

export interface Pose {
  hb: number; x: number; y: number; sx: number; sy: number; tilt: number;
  eye: EyeType; open: number; eyeRoll: number;
  lookX: number; lookY: number;
  handL: number; handR: number; wave: number;
  badge: number; tint: number;
  /** Spotlight strength, 0…1. */
  spot: number;
  /** Her name beside her: how visible (`lyricA`) and how much of it is sung (`lyric`). */
  lyricA: number; lyric: number;
  /** Footlights and particles fade with this when the greeting is cut short. */
  fx: number;
  card: number;
  /** She is not drawn below this line (the stage floor); ∞ once she is in the compact island. */
  floor: number;
  iw: number; ih: number;
}

function greetPose(t: number, sig: GreetSignature = "wave"): Pose {
  // Island size, for the footlights' spread.
  const gx = seg(t, 0, 0.5);
  const g = Math.sin((Math.PI * gx) / 2) + 0.04 * Math.sin(Math.PI * gx) * gx;
  const iw = lerp(NOTCH_W, GREETING_W, g);
  const ih = lerp(COMPACT.height, GREETING_H, g);

  const cx = C0.x;
  const cy = C0.y;
  const hb = t < T.rise0 ? 0 : HB;

  // The lift: up from under the floor, a touch past her mark, then settles.
  let y: number;
  if (t < T.rise0) y = LIFT_Y;
  else if (t < T.rise1) y = lerp(LIFT_Y, cy, E.back(seg(t, T.rise0, T.rise1)));
  else y = cy;

  // Body bob with the waving hand, and a little bow at the end.
  if (t >= T.pop1 && t < T.tuck0) {
    const w = t - T.pop1;
    y += Math.sin(w * 2 * Math.PI * 2.5) * 0.02 * HB * clamp(w / 0.08, 0, 1);
  }
  const bowK = bump(t, T.bow0, T.bow1);
  y += 0.1 * HB * bowK;

  // Stretched while the lift moves fast, squashed as it stops.
  const riseK = bump(t, T.rise0, T.rise0 + 0.4);
  const landK = bump(t, 0.82, 1.04);
  let sx = 1 - 0.1 * riseK + 0.14 * landK + 0.06 * bowK;
  let sy = 1 + 0.16 * riseK - 0.14 * landK - 0.05 * bowK;
  sx = 1 + (sx - 1) * SQUASH;
  sy = 1 + (sy - 1) * SQUASH;

  // Eyes
  let eye: EyeType = "dot";
  if (t >= 0.9 && t < 1.3) eye = "happy";
  if (t >= T.bow0 && t < T.bow1) eye = "content";
  const blink = (tb: number) => {
    const k = seg(t, tb, tb + 0.12);
    return k > 0 && k < 1 ? 1 - Math.sin(Math.PI * k) * 0.94 : 1;
  };
  const open = Math.min(blink(0.72), blink(1.75), blink(3.2));

  // Look: at the crowd, then at her name as it lights up, then back.
  let lookX = 0;
  let lookY = 0;
  if (t >= T.lyric0 && t < T.tuck0) {
    const k = E.inOut(seg(t, T.lyric0, T.lyric0 + 0.25));
    lookX = 0.55 * k;
    lookY = 0.15 * k;
  } else if (t >= T.tuck0) {
    const k = E.inOut(seg(t, T.tuck0, T.tuck0 + 0.3));
    lookX = lerp(0.55, 0, k);
    lookY = lerp(0.15, 0, k);
  }

  // Hands
  const handL = t < T.tuck0
    ? E.back(seg(t, T.pop0, T.pop0 + 0.14))
    : 1 - E.easeIn(seg(t, T.tuck0, T.tuck1 - 0.03));
  const handR = t < T.tuck0
    ? E.back(seg(t, T.pop0 + 0.04, T.pop0 + 0.18))
    : 1 - E.easeIn(seg(t, T.tuck0 + 0.03, T.tuck1));
  // How long she has been waving: the engine raises her hand, waveTilt() sways her.
  const wave = t >= T.pop1 && t < T.tuck0 ? t - T.pop1 : -1;
  let tilt = waveTilt({ wave } as Pose) + 0.05 * bowK;
  // The day's signature, in the wave's own window and rhythm: a wave as ever,
  // a bow that dips and rises, or a full twirl that lands back where it began.
  if (wave >= 0 && sig !== "wave") {
    const k = seg(wave, 0, T.tuck0 - T.pop1);
    if (sig === "bow") tilt = -0.34 * Math.sin(Math.PI * k);
    else tilt = Math.PI * 2 * E.inOut(k);
  }

  return {
    hb, x: cx, y, sx, sy, tilt,
    eye, open, eyeRoll: 0,
    lookX, lookY,
    handL, handR, wave,
    badge: E.back(seg(t, T.badge, T.badge + 0.28)),
    tint: 0.6 * E.inOut(seg(t, T.tint0, T.tint1)),
    spot: E.out(seg(t, 0.3, 0.75)),
    lyricA: E.out(seg(t, T.rise1, T.rise1 + 0.3)),
    lyric: E.inOut(seg(t, T.lyric0, T.lyric1)),
    fx: 1,
    card: seg(t, 0.12, 0.4),
    floor: FLOOR,
    iw, ih,
  };
}

function smallPose(): Pose {
  return {
    hb: (EAR_HB * COMPACT.botDiameter) / 20,
    x: GREETING_W / 2 - COMPACT.width / 2 + EAR_X,
    y: COMPACT.botCenterY,
    sx: 1, sy: 1, tilt: 0,
    eye: "dot", open: 1, eyeRoll: 0,
    lookX: 0, lookY: 0,
    handL: 0, handR: 0, wave: -1,
    badge: 1, tint: 0.6,
    spot: 0, lyricA: 0, lyric: 0,
    fx: 1,
    card: 0,
    floor: Number.POSITIVE_INFINITY,
    iw: COMPACT.width, ih: COMPACT.height,
  };
}

/** Miku's pose `t` seconds in; `tc` is when the collapse began (∞ if not yet). */
export function greetingPose(t: number, tc = Number.POSITIVE_INFINITY, sig: GreetSignature = "wave"): Pose {
  if (t < tc) return greetPose(Math.min(t, T.end + 10), sig);
  const a = greetPose(tc, sig);
  const b = smallPose();
  // Same curve and duration (340 ms) as the island shrinking around her, so the
  // island never gets ahead of her and cuts her off.
  const k = seg(t, tc, tc + T.COLLAPSE);
  const e = k >= 1 ? 1 : closeCurve(k);
  const p: Pose = { ...a };
  p.iw = lerp(a.iw, b.iw, e);
  p.ih = lerp(a.ih, b.ih, e);
  p.x = lerp(a.x, b.x, e);
  p.y = lerp(a.y, b.y, e);
  p.hb = lerp(a.hb, b.hb, e);
  p.badge = lerp(a.badge, b.badge, e);
  p.tint = lerp(a.tint, b.tint, e);
  p.spot = a.spot * (1 - seg(t, tc, tc + 0.15));
  p.lyricA = a.lyricA * (1 - seg(t, tc, tc + 0.1));
  p.card = a.card * (1 - seg(t, tc, tc + 0.18));
  p.handL = a.handL * (1 - seg(t, tc, tc + 0.15));
  p.handR = a.handR * (1 - seg(t, tc, tc + 0.15));
  p.tilt = a.tilt * (1 - e);
  p.sx = lerp(a.sx, 1, e);
  p.sy = lerp(a.sy, 1, e);
  p.eyeRoll = a.eyeRoll * (1 - e);
  const bk = seg(t, tc + 0.14, tc + 0.26);
  p.eye = "dot";
  p.open = bk > 0 && bk < 1 ? 1 - Math.sin(Math.PI * bk) * 0.94 : 1;
  p.lookX = a.lookX * (1 - e);
  p.lookY = a.lookY * (1 - e);
  p.fx = 1 - seg(t, tc, tc + 0.2);
  // The floor shrinks up with the island, so a greeting cut short mid-lift
  // never shows her legs under the stage.
  p.floor = e >= 1 ? b.floor : lerp(a.floor, COMPACT.height, e);
  return p;
}

/**
 * The chibi waves with her own hand (the engine poses her from `wave`, see
 * BotEngine.syncGreeting). Her body only sways along, gently.
 */
function waveTilt(p: Pose): number {
  if (p.wave < 0) return 0;
  const w = p.wave;
  const rampIn = clamp(w / 0.08, 0, 1);
  const rampOut = 1 - clamp((w - (T.tuck0 - T.pop1)) / (T.tuck1 - T.tuck0), 0, 1);
  return Math.sin(w * 2 * Math.PI * 2.5) * 0.045 * rampIn * rampOut;
}

/**
 * Bounding box of the figure in the 640×150 space as it is painted — what must
 * stay inside the island so nothing of it is cut off. The engine draws the
 * whole chibi inside a square of `hb / 0.6`, filling about 62 % of its height;
 * the stage floor clips whatever is still under it.
 */
export function mochiBounds(p: Pose): { left: number; right: number; top: number; bottom: number } | null {
  const hh = p.hb / 2;
  if (hh <= 0.4) return null;
  const side = p.hb / 0.6;
  const halfW = side * 0.5 * 0.62;
  const top = p.y + (-side * 0.5 + side * 0.19) * p.sy;
  const bottom = Math.min(p.floor, p.y + (-side * 0.5 + side * 0.81) * p.sy);
  if (top >= bottom) return null;
  return { left: p.x - halfW * p.sx, right: p.x + halfW * p.sx, top, bottom };
}

// ── Particles (seeded LCG, so every launch plays the same show) ───────────────

interface Note { t0: number; dx: number; y0: number; drift: number; size: number; spin: number; glyph: string }

const NOTES: Note[] = (() => {
  let seed = 7;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  return Array.from({ length: 14 }, (_, i) => ({
    t0: lerp(T.notes0, T.notes1 - 0.9, i / 13) + rnd() * 0.08,
    // Either side of her, never over her face.
    dx: (rnd() < 0.5 ? -1 : 1) * (40 + rnd() * 70),
    y0: rnd(),
    drift: (rnd() - 0.5) * 16,
    size: 0.8 + rnd() * 0.5,
    spin: (rnd() - 0.5) * 2,
    glyph: rnd() < 0.6 ? "♪" : "♫",
  }));
})();
const NOTE_LIFE = 1.0;
const FOOTLIGHTS = 22;

const rgba = (c: readonly number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ── Drawing ───────────────────────────────────────────────────────────────────

function rr(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number) {
  const r = Math.max(0, Math.min(R, W / 2, H / 2));
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}

/** The spotlight: a soft cone from the top of the stage down onto her mark. */
function drawSpot(x: CanvasRenderingContext2D, p: Pose, c: readonly number[]) {
  if (p.spot <= 0.01) return;
  const top = CARD.y;
  const g = x.createLinearGradient(0, top, 0, FLOOR);
  g.addColorStop(0, rgba(c, 0.02 * p.spot));
  g.addColorStop(1, rgba(c, 0.2 * p.spot));
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(C0.x - 22, top);
  x.lineTo(C0.x + 22, top);
  x.lineTo(C0.x + 92, FLOOR);
  x.lineTo(C0.x - 92, FLOOR);
  x.closePath();
  x.fill();
  // The pool of light on the floor.
  const pool = x.createRadialGradient(C0.x, FLOOR, 0, C0.x, FLOOR, 110);
  pool.addColorStop(0, rgba(c, 0.32 * p.spot));
  pool.addColorStop(1, rgba(c, 0));
  x.fillStyle = pool;
  x.fillRect(C0.x - 110, FLOOR - 30, 220, 32);
}

/** Footlights: on one by one from the left, then one pulse at the bow. */
function drawFootlights(x: CanvasRenderingContext2D, t: number, p: Pose, c: readonly number[]) {
  const span = Math.min(p.iw, CARD.w) - 40;
  const left = GREETING_W / 2 - span / 2;
  const pulseT = seg(t, T.pulse0, T.pulse1);
  for (let i = 0; i < FOOTLIGHTS; i++) {
    const f = i / (FOOTLIGHTS - 1);
    const on = T.sweep0 + f * (T.sweep1 - T.sweep0);
    if (t < on) continue;
    // A flash as it comes on, settling to a glow.
    let a = 0.35 + 0.65 * Math.exp(-(t - on) * 7);
    // The pulse runs left to right too.
    const pk = pulseT > 0 && pulseT < 1 ? Math.max(0, 1 - Math.abs(pulseT * 1.4 - f - 0.2) * 5) : 0;
    a = Math.min(1, a + 0.65 * pk) * p.fx;
    const px = left + f * span;
    const glow = x.createRadialGradient(px, FLOOR, 0, px, FLOOR, 9);
    glow.addColorStop(0, rgba(c, 0.55 * a));
    glow.addColorStop(1, rgba(c, 0));
    x.fillStyle = glow;
    x.fillRect(px - 9, FLOOR - 9, 18, 18);
    x.fillStyle = `rgba(255,255,255,${0.9 * a})`;
    x.fillRect(px - 1, FLOOR - 1, 2, 2);
  }
  // The stage edge lights up with the pulse.
  const edge = bump(t, T.pulse0, T.pulse1) * p.fx;
  if (edge > 0.01) {
    const g = x.createLinearGradient(CARD.x, 0, CARD.x + CARD.w, 0);
    g.addColorStop(0, rgba(c, 0));
    g.addColorStop(0.5, rgba(c, 0.9 * edge));
    g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g;
    x.fillRect(CARD.x, CARD.y + CARD.h - 2, CARD.w, 2);
  }
}

/** Notes rise around her; Snow's snowflakes and Sakura's petals fall instead. */
function drawNotes(x: CanvasRenderingContext2D, t: number, p: Pose, variant: MikuVariantId, c: readonly number[]) {
  const falls = variant !== "classic";
  for (const n of NOTES) {
    const k = (t - n.t0) / NOTE_LIFE;
    if (k <= 0 || k >= 1) continue;
    const px = C0.x + n.dx + Math.sin(k * Math.PI * 2) * 6 + n.drift * k;
    const py = falls ? lerp(CARD.y + 6 + n.y0 * 20, FLOOR - 14, k) : lerp(FLOOR - 30 - n.y0 * 20, CARD.y + 8, k);
    x.save();
    x.globalAlpha = Math.sin(Math.PI * k) * p.fx;
    x.translate(px, py);
    x.rotate(n.spin * k);
    if (variant === "snow") snowflake(x, 0, 0, 5 * n.size, "rgba(220,236,255,0.95)");
    else if (variant === "sakura") petal(x, 5 * n.size);
    else {
      x.fillStyle = rgba(c, 1);
      x.font = `700 ${Math.round(15 * n.size)}px system-ui, sans-serif`;
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.fillText(n.glyph, 0, 0);
    }
    x.restore();
  }
}

/** Her name, sung karaoke-style: the stage colour wipes across the dim letters. */
function drawLyric(x: CanvasRenderingContext2D, p: Pose, c: readonly number[]) {
  if (p.lyricA <= 0.01) return;
  x.save();
  x.globalAlpha = p.lyricA;
  x.font = LYRIC.font;
  x.textBaseline = "alphabetic";
  x.textAlign = "left";
  const w = x.measureText(LYRIC.text).width;
  x.fillStyle = "rgba(255,255,255,0.16)";
  x.fillText(LYRIC.text, LYRIC.x, LYRIC.y);
  if (p.lyric > 0) {
    x.beginPath();
    x.rect(LYRIC.x - 2, LYRIC.y - 40, (w + 4) * p.lyric, 52);
    x.clip();
    x.shadowColor = rgba(c, 0.8);
    x.shadowBlur = 12;
    x.fillStyle = rgba(c, 1);
    x.fillText(LYRIC.text, LYRIC.x, LYRIC.y);
  }
  x.restore();
}

function drawMiku(x: CanvasRenderingContext2D, p: Pose, engine: BotEngine) {
  const hh = p.hb / 2;
  const hw = hh * ASP;
  if (hh <= 0.4) return;

  // The mascot is the island's own engine, so the greeting can never show a
  // different character from the one that lands in the compact island.
  x.save();
  if (Number.isFinite(p.floor)) {
    x.beginPath();
    x.rect(0, 0, GREETING_W, p.floor);
    x.clip();
  }
  x.translate(p.x, p.y);
  x.rotate(p.tilt);
  x.scale(p.sx, p.sy);
  const side = p.hb / 0.6; // the engine draws the body at 60 % of its box
  engine.syncGreeting(p);
  x.translate(-side / 2, -side / 2);
  engine.draw(x, side, side);
  x.restore();

  // Activity badge, over the whole thing (the engine's own sits inside its box,
  // which the greeting scales differently).
  if (p.badge > 0.01) {
    const br = hh * 0.3;
    x.save();
    x.translate(p.x - hw * 0.78, p.y - hh * 0.72);
    x.scale(p.badge, p.badge);
    x.fillStyle = "#000";
    x.beginPath();
    x.arc(0, 0, br + hh * 0.07, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "#3BA0F5";
    x.beginPath();
    x.arc(0, 0, br, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "#0B1B3A";
    for (const i of [-1, 0, 1]) {
      x.beginPath();
      x.arc(i * br * 0.5, 0, br * 0.17, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }
}

// ── Controller ────────────────────────────────────────────────────────────────

/**
 * Runs the greeting animation on its own canvas. `onComplete` fires once at
 * T.end (or right after the collapse when interrupted) so the FSM can move on.
 */
export class Greeting {
  private startMs = 0;
  private tc = Number.POSITIVE_INFINITY;
  private fired = false;
  private timers: number[] = [];
  private variant: MikuVariantId = "classic";
  /** The island's own engine, so the greeting shows the same Miku it lands as. */
  private engine = new BotEngine();
  /** Today's hello, picked once at start. */
  private sig: GreetSignature = "wave";

  onComplete: (() => void) | null = null;

  /** Which Miku: the wardrobe's choice, as the island draws it too. */
  setVariant(id: MikuVariantId) {
    this.variant = id;
    this.engine.setVariant(id);
  }

  start() {
    this.startMs = performance.now();
    this.tc = Number.POSITIVE_INFINITY;
    this.fired = false;
    this.sig = greetSignature(todayNumber());
    this.cancelTimers();
    // The score plays from the start; it outlives greetComplete a little on
    // purpose and fades when the greeting view goes away (see leave()).
    Sound.play(GREETING_SOUND);
    this.timers.push(window.setTimeout(() => this.fire(), (T.end + 0.05) * 1000));
  }

  /** Mouse entered the island during the greeting — hold it open. */
  hover() {
    if (this.tc >= T.autoLeave) this.tc = Number.POSITIVE_INFINITY;
  }

  /** Mouse left — collapse from now. */
  interrupt() {
    const t = (performance.now() - this.startMs) / 1000;
    if (!Number.isFinite(this.tc) || this.tc > t) this.tc = t;
    this.cancelTimers();
    Sound.fadeOut(GREETING_SOUND, 0.25);
  }

  /** The greeting view is gone: let what is left of its sound fade away. */
  leave() {
    this.cancelTimers();
    Sound.fadeOut(GREETING_SOUND, 0.2);
  }

  get elapsed(): number {
    return (performance.now() - this.startMs) / 1000;
  }

  get done(): boolean {
    return this.fired;
  }

  private fire() {
    if (this.fired) return;
    this.fired = true;
    this.cancelTimers();
    this.onComplete?.();
  }

  private cancelTimers() {
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers = [];
  }

  draw(x: CanvasRenderingContext2D) {
    const t = this.elapsed;
    if (!this.fired && t >= T.end && this.tc >= T.autoLeave) this.fire();

    const p = greetingPose(t, this.tc, this.sig);
    const c = STAGE[this.variant];
    x.clearRect(0, 0, GREETING_W, GREETING_H);

    if (p.card > 0) {
      // The stage: the island's black, leaning toward her light.
      x.save();
      x.globalAlpha = p.card;
      rr(x, CARD.x, CARD.y, CARD.w, CARD.h, CARD_R);
      x.fillStyle = `rgb(${Math.round(16 + c[0] * 0.05)},${Math.round(17 + c[1] * 0.05)},${Math.round(20 + c[2] * 0.05)})`;
      x.fill();
      x.clip();
      drawSpot(x, p, c);
      drawFootlights(x, t, p, c);
      x.globalAlpha = 1;
      drawNotes(x, t, p, this.variant, c);
      drawLyric(x, p, c);
      x.restore();
    }

    drawMiku(x, p, this.engine);
  }
}
