// The launch greeting, "Hologram": no island at first. A projection disc lights
// up on the desktop under the notch, a column of light rises from it, and Miku is
// rendered into it slice by slice, glitching, feet to head — a virtual singer,
// projected. Solid, she holds her pose of the day among drifting 0/1 bits. Then
// she shrinks up into the notch's corner and the mini notch grows around her face.
// The island stays transparent the whole time (style.css, #island[data-view=
// "greeting"]); everything here is drawn on the greeting canvas, laid out in the
// 640×150 space the island uses, the notch ending exactly where the real one sits.

import { closeCurve } from "../core/anim";
import { Sound } from "../core/sound";
import { COMPACT_W, NOTCH_H } from "../core/layout";
import { CHIBI_H, CHIBI_W, drawChibi, type ChibiPose } from "./chibi";
import type { MikuVariantId } from "./variants";

// ── Timing ────────────────────────────────────────────────────────────────────

const T = {
  // After the (invisible, but clipping) island has sprung open to full height.
  disc0: 0.25,
  disc1: 0.6,
  build0: 0.6,
  build1: 1.6,
  solid0: 1.5,
  solid1: 1.9,
  bits0: 1.9,
  bits1: 2.9,
  end: 3.0,
  /** The shrink into the notch: as long as the island's own close (340 ms). */
  COLLAPSE: 0.34,
  autoLeave: 3.3,
};

export const GREETING_END = T.end;

/** The greeting's own sound, played from the start: one spoken hello, at random. */
const GREETING_SOUNDS = ["greeting-matteta", "greeting-yoroshiku", "greeting-ganbarou"] as const;

/** The hello for this hour: "こんばんは" from 18:00 to 04:00, else one of the three at random. */
export function greetingSound(hour: number, random = Math.random()): string {
  if (hour >= 18 || hour < 4) return "greeting-konbanwa";
  return GREETING_SOUNDS[Math.floor(random * GREETING_SOUNDS.length)];
}

// ── The day's pose ────────────────────────────────────────────────────────────

/** The pose she holds once solid: stable per day, a different one tomorrow. */
export function greetPose(day: number): ChibiPose {
  return (["wink", "wave", "leek"] as const)[((day % 3) + 3) % 3];
}

/** Today as a day-ordinal, for greetPose. */
export function todayNumber(d = new Date()): number {
  return d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
}

// ── Geometry (640×150) ────────────────────────────────────────────────────────

export const GREETING_W = 640;
export const GREETING_H = 150;
/** Where she stands while projected: feet on the disc. */
export const FOOT = { x: GREETING_W / 2, y: 130 };
/** Her height while projected. */
const SIZE = 100;
/** The disc's radii. */
const DISC = { rx: 60, ry: 9 };
/**
 * Where she lands: the island she folds into (centred under the top edge) and
 * her face in it, `face.x` from its left edge — or no face when that island
 * shows none, and no island at all (w = 0) when the closed island is turned off.
 */
export interface Landing {
  w: number; h: number; r: number;
  face: { x: number; y: number; r: number } | null;
  /** Its fill, top to bottom: the island's own (style.css, #island). */
  fill: readonly [string, string];
}
/** The compact island: the mini notch, her face at its left end (island.ts). */
export const COMPACT_LANDING: Landing = {
  w: COMPACT_W, h: NOTCH_H, r: 14, face: { x: 40, y: NOTCH_H / 2, r: 10 }, fill: ["#0d1322", "#18213a"],
};
/** Her face's centre in the 640 px space, for a landing. */
export function faceAt(land: Landing): { x: number; y: number; r: number } {
  const f = land.face ?? { x: land.w / 2, y: 0, r: 4 };
  return { x: GREETING_W / 2 - land.w / 2 + f.x, y: f.y, r: f.r };
}
/** The chibi's design-space width per unit of height, and half of it. */
const HALF_W = (CHIBI_W / CHIBI_H) * 0.5;

/** Hologram light per Miku: her hair, except Snow's white hair, lit ice-blue. */
const LIGHT: Record<MikuVariantId, readonly [number, number, number]> = {
  classic: [57, 197, 187],
  snow: [127, 184, 240],
  sakura: [245, 168, 199],
};

// ── Easing ────────────────────────────────────────────────────────────────────

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
const out = (t: number) => 1 - Math.pow(1 - t, 3);

// ── Pose ──────────────────────────────────────────────────────────────────────

export interface Pose {
  /** Disc and light column, 0…1. */
  disc: number;
  /** How much of her is rendered, feet to head, 0…1. */
  build: number;
  /** 0 a teal hologram, 1 her own colours. */
  solid: number;
  /** The 0/1 bits around her, 0…1. */
  bits: number;
  /** 0 projected, 1 shrunk into the notch (on the close curve). */
  shrink: number;
  /** Feet position and height of the figure. */
  x: number; y: number; size: number;
  /** The island she lands in, 0…1, and her face in it. */
  notch: number; face: number;
  land: Landing;
}

/** Her pose `t` seconds in; `tc` is when the collapse began (∞ if not yet). */
export function greetingPose(t: number, tc = Number.POSITIVE_INFINITY, land = COMPACT_LANDING): Pose {
  const FACE = faceAt(land);
  const s = Math.min(t, tc);
  /** How far into the collapse, over `d` seconds: 0 while there is none. */
  const cut = (d: number) => (Number.isFinite(tc) ? seg(t, tc, tc + d) : 0);
  const k = cut(T.COLLAPSE);
  const e = k >= 1 ? 1 : closeCurve(k);
  // Cut short mid-build, she leaves as much of her as was there.
  return {
    // Gone before the island, closing, reaches the floor it stands on.
    disc: out(seg(s, T.disc0, T.disc1)) * (1 - cut(0.08)),
    build: seg(s, T.build0, T.build1),
    solid: seg(s, T.solid0, T.solid1) * (1 - e),
    bits: seg(s, T.bits0, T.bits0 + 0.3) * (1 - seg(s, T.bits1 - 0.2, T.bits1)) * (1 - cut(0.1)),
    shrink: e,
    x: lerp(FOOT.x, FACE.x, e),
    y: lerp(FOOT.y, FACE.y + FACE.r, e),
    size: lerp(SIZE, FACE.r * 2.4, e),
    notch: e,
    // No face to land as: she fades out on the way up instead.
    face: land.face ? seg(k, 0.7, 1) : seg(k, 0.4, 0.9),
    land,
  };
}

/**
 * The box of everything drawn for her in the 640×150 space — what must stay
 * inside the island so nothing is cut off. While projected that is her figure
 * (and its glitch) on the disc; shrunk, her face in the notch.
 */
export function mochiBounds(p: Pose): { left: number; right: number; top: number; bottom: number } | null {
  const boxes: { left: number; right: number; top: number; bottom: number }[] = [];
  if (p.disc > 0) {
    const rx = DISC.rx * p.disc;
    boxes.push({ left: FOOT.x - rx, right: FOOT.x + rx, top: FOOT.y - SIZE - 6, bottom: FOOT.y + 2 + DISC.ry * p.disc });
  }
  if (p.build > 0 && p.face < 1) {
    const half = p.size * HALF_W + GLITCH * (1 - p.shrink) * p.size / SIZE;
    boxes.push({ left: p.x - half, right: p.x + half, top: p.y - p.size, bottom: p.y });
  }
  if (p.notch > 0 && p.land.w > 0) {
    const half = (p.land.w * p.notch) / 2;
    boxes.push({ left: GREETING_W / 2 - half, right: GREETING_W / 2 + half, top: 0, bottom: p.land.h * Math.min(1, p.notch * 1.5) });
  }
  if (boxes.length === 0) return null;
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    right: Math.max(...boxes.map((b) => b.right)),
    top: Math.min(...boxes.map((b) => b.top)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

/** How far a slice is thrown sideways while it glitches in. */
const GLITCH = 14;

// ── Drawing ───────────────────────────────────────────────────────────────────

const rgba = (c: readonly number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** The disc on the desktop and the column of light rising from it. */
function drawDisc(x: CanvasRenderingContext2D, p: Pose, c: readonly number[]) {
  const d = p.disc;
  if (d <= 0.01) return;
  const top = FOOT.y - SIZE - 6;
  const g = x.createLinearGradient(0, FOOT.y, 0, top);
  g.addColorStop(0, rgba(c, 0.3 * d));
  g.addColorStop(1, rgba(c, 0));
  x.fillStyle = g;
  const rise = out(clamp(d * 1.3 - 0.3, 0, 1));
  x.fillRect(FOOT.x - DISC.rx + 4, FOOT.y - (FOOT.y - top) * rise, (DISC.rx - 4) * 2, (FOOT.y - top) * rise);
  x.save();
  x.strokeStyle = rgba(c, 0.9 * d);
  x.lineWidth = 2;
  x.shadowColor = rgba(c, d);
  x.shadowBlur = 10;
  x.beginPath();
  x.ellipse(FOOT.x, FOOT.y + 2, DISC.rx * d, DISC.ry * d, 0, 0, Math.PI * 2);
  x.stroke();
  x.fillStyle = rgba(c, 0.18 * d);
  x.fill();
  x.restore();
}

/** Her figure, rendered off-screen so it can be sliced, tinted and moved. */
const SLICES = 30;
function drawFigure(
  x: CanvasRenderingContext2D, off: HTMLCanvasElement, p: Pose, t: number,
  pose: ChibiPose, variant: MikuVariantId, c: readonly number[],
) {
  if (p.build <= 0 || p.face >= 1) return;
  // Rendered at its projected size, twice over for sharpness, whatever she shrinks to.
  const S = 2;
  const w = Math.ceil(SIZE * HALF_W * 2 + 8);
  const h = SIZE + 6;
  if (off.width !== w * S) { off.width = w * S; off.height = h * S; }
  const o = off.getContext("2d");
  if (!o) return;
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.clearRect(0, 0, off.width, off.height);
  const k = (SIZE / CHIBI_H) * S;
  o.setTransform(k, 0, 0, k, (w * S) / 2 - (CHIBI_W / 2) * k, (h - 2) * S - 480 * k);
  drawChibi(o, pose, t, variant, { noShadow: true });
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = "source-atop";
  o.fillStyle = rgba(c, 0.75 * (1 - p.solid));
  o.fillRect(0, 0, off.width, off.height);
  o.globalCompositeOperation = "source-over";

  const scale = p.size / SIZE;
  const sh = h / SLICES;
  x.save();
  x.globalAlpha = 1 - p.face;
  x.translate(p.x, p.y);
  x.scale(scale, scale);
  // A soft edge in her light, so she holds up on a white wallpaper too.
  x.shadowColor = rgba(c, 0.75);
  x.shadowBlur = 7;
  for (let i = 0; i < SLICES; i++) {
    // Slices arrive bottom → top, each thrown sideways a moment, then settling.
    const from = 1 - (i + 1) / SLICES;
    const show = clamp((p.build - from) * SLICES * 0.6, 0, 1);
    if (show <= 0) continue;
    const jit = (1 - show) * GLITCH * Math.sin(i * 12.9 + t * 40)
      + Math.sin(i * 3.1 + t * 25) * 1.4 * (1 - p.solid) * (1 - p.shrink);
    x.globalAlpha = show * (1 - p.face);
    x.drawImage(off, 0, i * sh * S, w * S, sh * S, -w / 2 + jit, -h + 2 + i * sh, w, sh + 0.5);
  }
  x.restore();
  // The scanline riding up while she builds.
  if (p.build < 1 && p.shrink === 0) {
    const y = FOOT.y - (h - 2) * p.build;
    x.fillStyle = rgba(c, 0.95);
    x.fillRect(FOOT.x - DISC.rx, y, DISC.rx * 2, 2);
    x.fillStyle = rgba(c, 0.22);
    x.fillRect(FOOT.x - DISC.rx, y - 6, DISC.rx * 2, 12);
  }
}

/** 0/1 bits drifting up around her while she holds the pose. */
function drawBits(x: CanvasRenderingContext2D, p: Pose, t: number, c: readonly number[]) {
  if (p.bits <= 0.01) return;
  x.save();
  x.font = "600 10px Consolas, monospace";
  x.textAlign = "center";
  for (let i = 0; i < 10; i++) {
    const q = (t * 0.6 + i / 10) % 1;
    x.fillStyle = rgba(c, p.bits * (1 - q) * 0.85);
    x.fillText(i % 2 ? "1" : "0", FOOT.x + Math.sin(i * 2.3) * 70, FOOT.y - 14 - q * 100);
  }
  x.restore();
}

/** The island growing around her face, where island.ts will draw the real one. */
function drawNotch(x: CanvasRenderingContext2D, p: Pose, t: number, variant: MikuVariantId, c: readonly number[]) {
  const land = p.land;
  if (p.notch <= 0 || land.w <= 0) return;
  const w = land.w * p.notch;
  const h = land.h * Math.min(1, p.notch * 1.5);
  const X = GREETING_W / 2 - w / 2;
  const r = Math.min(land.r, h / 2);
  const g = x.createLinearGradient(0, 0, 0, land.h);
  g.addColorStop(0, land.fill[0]);
  g.addColorStop(1, land.fill[1]);
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(X, 0);
  x.lineTo(X + w, 0);
  x.lineTo(X + w, h - r);
  x.arcTo(X + w, h, X + w - r, h, r);
  x.lineTo(X + r, h);
  x.arcTo(X, h, X, h - r, r);
  x.closePath();
  x.fill();
  if (p.face <= 0 || !land.face) return;
  // Her face, the way the island shows her there (BotEngine.faceOnly).
  const FACE = faceAt(land);
  const k = FACE.r / 118;
  x.save();
  x.globalAlpha = p.face;
  x.beginPath();
  x.arc(FACE.x, FACE.y, FACE.r, 0, Math.PI * 2);
  x.clip();
  x.translate(FACE.x - 260 * k, FACE.y - 182 * k);
  x.scale(k, k);
  drawChibi(x, "idle", t, variant, { noShadow: true });
  x.restore();
  // A blink of her light where she lands.
  const flash = 1 - p.face;
  if (flash > 0) {
    x.fillStyle = rgba(c, 0.5 * flash);
    x.beginPath();
    x.arc(FACE.x, FACE.y, FACE.r + 8 * flash, 0, Math.PI * 2);
    x.fill();
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
  private off: HTMLCanvasElement | null = null;
  /** Today's pose, picked once at start. */
  private pose: ChibiPose = "wink";
  private sound = greetingSound(12, 0);
  private land: Landing = COMPACT_LANDING;

  onComplete: (() => void) | null = null;

  /** Which Miku: the wardrobe's choice, as the island draws it too. */
  setVariant(id: MikuVariantId) {
    this.variant = id;
  }

  start() {
    this.startMs = performance.now();
    this.tc = Number.POSITIVE_INFINITY;
    this.fired = false;
    this.pose = greetPose(todayNumber());
    this.cancelTimers();
    // The hello plays from the start; it outlives greetComplete a little on
    // purpose and fades when the greeting view goes away (see leave()).
    this.sound = greetingSound(new Date().getHours());
    Sound.play(this.sound);
    this.timers.push(window.setTimeout(() => this.fire(), (T.end + 0.05) * 1000));
  }

  /** Mouse entered the island during the greeting — hold it open. */
  hover() {
    if (this.tc >= T.autoLeave) this.tc = Number.POSITIVE_INFINITY;
  }

  /** The greeting is over (mouse left, or the FSM moved on): shrink into `land` from now. */
  interrupt(land: Landing = COMPACT_LANDING) {
    this.land = land;
    const t = this.elapsed;
    if (!Number.isFinite(this.tc) || this.tc > t) this.tc = t;
    this.cancelTimers();
    Sound.fadeOut(this.sound, 0.25);
  }

  /** The greeting view is gone: let what is left of its sound fade away. */
  leave() {
    this.cancelTimers();
    Sound.fadeOut(this.sound, 0.2);
  }

  get elapsed(): number {
    return (performance.now() - this.startMs) / 1000;
  }

  get done(): boolean {
    return this.fired;
  }

  /** Seconds the shrink into the notch takes, so the island keeps drawing it. */
  static readonly COLLAPSE = T.COLLAPSE;

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
    const p = greetingPose(t, this.tc, this.land);
    const c = LIGHT[this.variant];
    x.clearRect(0, 0, GREETING_W, GREETING_H);
    this.off ??= document.createElement("canvas");
    // Her pose: still while she is being built, the day's once she is solid,
    // a happy one on the way up into the notch.
    const pose: ChibiPose = p.shrink > 0 ? "happy" : t < T.solid1 ? "idle" : this.pose;
    drawDisc(x, p, c);
    drawFigure(x, this.off, p, t, pose, this.variant, c);
    drawBits(x, p, t, c);
    drawNotch(x, p, t, this.variant, c);
  }
}
