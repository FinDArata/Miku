// Mochi — direct port of NotchBuddy/Sources/App/BotEngine.swift to Canvas 2D.
// Same constants, same tweens, same easings, same particles. The only intentional
// difference is the `happy`/`wink` eye arc, which follows the prototype
// (design/prototype/notch-buddy.html, the visual source of truth) — the Swift
// arc angles produce a different shape.

import { Ease, lerp, reducedMotion, type EaseFn } from "../core/anim";
import { Sound } from "../core/sound";
import type { BotEmoteName, BotStateName } from "../core/layout";
import { drawOutfitBehind, drawOutfitFront, type Head } from "./outfits";
import type { Outfit } from "./wardrobe";
import { DEFAULT_VARIANT, MIKU_VARIANTS, type MikuVariant, type MikuVariantId } from "./variants";
import { BeatTracker, musicEnergy as danceEnergy } from "./music";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EyeShape =
  | "pill" | "wide" | "dot" | "line" | "flat" | "happy" | "closed"
  | "spiral" | "heart" | "star" | "tired" | "wink" | "cup";

export type BadgeKind = "dots" | "bang" | "question" | "dot" | "arrow";

export interface Badge {
  kind: BadgeKind;
  color: RGB;
}

export type RGB = readonly [number, number, number]; // components 0…1

export type TweenKey = readonly [target: number, durationMs: number, ease: EaseFn];

interface Tween {
  prop: PropKey;
  keys: TweenKey[];
  index: number;
  from: number;
  startMs: number;
  onComplete?: () => void;
}

type PropKey =
  | "yaw" | "pitch" | "roll" | "tilt" | "open" | "sx" | "sy"
  | "oy" | "ox" | "tint" | "morph" | "hands" | "blush" | "es" | "badgeS"
  | "outfitPresence";

interface BotStateCfg {
  color: RGB;
  tint: number;
  eye: EyeShape;
  badge: Badge | null;
  bounces: boolean;
  scans: boolean;
  breathes: boolean;
  zz: boolean;
  sweat: boolean;
  look: readonly [number, number] | null;
  tilt: number;
}

interface Particle {
  type: "heart" | "star" | "spark" | "sweat" | "z" | "petal" | "snowflake";
  x: number; y: number; vx: number; vy: number;
  age: number; life: number; rot: number; size: number;
}

/** The gradients of one variant, made by one canvas context. */
interface GradientCache {
  variant: MikuVariant;
  hair?: CanvasGradient;
  tails?: [CanvasGradient, CanvasGradient];
  skirt?: CanvasGradient;
  /** By rounded (ey, es): the iris follows the gaze and the surprise. */
  iris: Map<number, CanvasGradient>;
}

// ── Constants ─────────────────────────────────────────────────────────────────
// (Mochi's squircle constants retired with the Miku chibi; see K_* below.)

const MINI_INK = "rgb(16,19,26)"; // #10131A

// ── Miku — chibi drawn in code, in three official variants ───────────────────
//
// The palette used to be constants here (the earlier fork's Miku chibi). It now
// comes from ./variants.ts, one MikuVariant per look: classic, Snow and Sakura
// share every shape and differ in colour, plus the few ornaments the variant
// paints itself through `extra`. `engine.setVariant()` swaps it at runtime.
//
// Coordinates below are the 0..300 prototype space, character centred on
// (150, ~150) — the same system the old chibi used, so outfits and the mini bots
// keep working untouched.
const INK = "rgb(32,36,46)";

function mixRGB(a: RGB, b: RGB, k: number): RGB {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/**
 * The head the outfits hang on: Miku's own, not the old Mochi's.
 *
 * The hat, glasses and scarf code (outfits.ts) measures everything in head
 * radii, and was written for a head of (R·1.14, R·0.88). Miku's head is the
 * hair cap at (150, 64) in the 0..300 prototype space, with radii 88×80; `u`
 * turns those into canvas pixels. The caller moves the context up to that
 * centre first, so a hat lands on the crown instead of floating over the body.
 */
function dressedHead(
  u: number,
  yaw: number,
  pitch: number,
  physDx: number,
  physDy: number,
): Head {
  const rx = 88 * u;
  const ry = 80 * u;
  return { R: rx, rx, ry, yaw, pitch, physDx, physDy };
}

/**
 * The headset's mic boom: a thin arm from the right ear down to a small capsule
 * by the mouth. Shared by the three variants, coloured by `headset`.
 */
function micBoom(x: CanvasRenderingContext2D, col: RGB) {
  x.strokeStyle = rgba(col);
  x.lineWidth = 2.4;
  x.lineCap = "round";
  x.beginPath();
  x.moveTo(150 + 80, 92);
  x.quadraticCurveTo(150 + 84, 116, 150 + 62, 124);
  x.stroke();
  x.fillStyle = rgba(col);
  x.beginPath();
  x.ellipse(150 + 58, 125, 4.6, 3.8, -0.5, 0, Math.PI * 2);
  x.fill();
}

/**
 * The "01" tattooed on the left sleeve — the one mark every Miku wears, and the
 * reason the armband is drawn on the body rather than with the outfit.
 */
function armband(x: CanvasRenderingContext2D, col: RGB, plate: RGB) {
  x.fillStyle = rgba(plate);
  roundRectPath(x, 96, 158, 20, 22, 4);
  x.fill();
  x.fillStyle = rgba(col);
  x.font = `700 13px ${FONT}`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText("01", 106, 169);
}


const C = {
  idle: [0.902, 0.914, 0.933] as RGB,
  working: [0.231, 0.62, 1] as RGB,
  thinking: [0.545, 0.361, 0.965] as RGB,
  searching: [0.388, 0.396, 0.949] as RGB,
  approval: [0.961, 0.647, 0.141] as RGB,
  question: [0.133, 0.827, 0.933] as RGB,
  error: [0.957, 0.314, 0.369] as RGB,
  finished: [0.204, 0.831, 0.6] as RGB,
  ratelimit: [0.984, 0.573, 0.235] as RGB,
  sleeping: [0.58, 0.635, 0.722] as RGB,
  dizzy: [0.957, 0.447, 0.714] as RGB,
};

const base = {
  bounces: false, scans: false, breathes: false, zz: false, sweat: false,
  look: null, tilt: 0,
};

export const BOT_STATES: Record<BotStateName, BotStateCfg> = {
  idle: { ...base, color: C.idle, tint: 0, eye: "pill", badge: null },
  working: { ...base, color: C.working, tint: 0.72, eye: "pill", badge: { kind: "dots", color: C.working } },
  thinking: { ...base, color: C.thinking, tint: 0.72, eye: "pill", badge: { kind: "dots", color: C.thinking }, look: [0.55, 0.55] },
  searching: { ...base, color: C.searching, tint: 0.72, eye: "pill", badge: { kind: "dots", color: C.searching }, scans: true },
  approval: { ...base, color: C.approval, tint: 0.78, eye: "wide", badge: { kind: "bang", color: C.approval }, bounces: true },
  question: { ...base, color: C.question, tint: 0.75, eye: "pill", badge: { kind: "question", color: C.question }, tilt: 0.17 },
  error: { ...base, color: C.error, tint: 0.78, eye: "flat", badge: { kind: "dot", color: C.error } },
  finished: { ...base, color: C.finished, tint: 0.35, eye: "happy", badge: { kind: "dot", color: C.finished } },
  ratelimit: { ...base, color: C.ratelimit, tint: 0.72, eye: "tired", badge: { kind: "dot", color: C.ratelimit }, sweat: true },
  sleeping: { ...base, color: C.sleeping, tint: 0.32, eye: "closed", badge: null, breathes: true, zz: true },
  dizzy: { ...base, color: C.dizzy, tint: 0.7, eye: "spiral", badge: null },
};

/** State → sound, as in BotStateCfg.sound. */
export const STATE_SOUND: Partial<Record<BotStateName, string>> = {
  working: "work", thinking: "think", searching: "search", approval: "approval",
  question: "question", error: "error", finished: "finish", ratelimit: "rate",
  sleeping: "sleep", dizzy: "dizzy",
};

const EMOTE_EYE: Record<BotEmoteName, EyeShape> = {
  love: "heart", surprised: "dot", proud: "star", wink: "wink",
  yawn: "tired", happy: "happy", annoyed: "line",
};

// ── Small helpers ─────────────────────────────────────────────────────────────

const now = () => performance.now() / 1000;

export function hexToRGB(hex: string): RGB {
  const h = hex.replace("#", "");
  const v = parseInt(h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// The palette asks for these strings dozens of times a frame; the channels of
// each colour are read once and kept, as hero.ts does for its particles.
const channels = new Map<number, string>();

const rgba = (c: RGB, a = 1) => {
  const key = (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
  let rgb = channels.get(key);
  if (rgb === undefined) {
    rgb = `${key >> 16},${(key >> 8) & 255},${key & 255}`;
    if (channels.size > 1024) channels.clear();
    channels.set(key, rgb);
  }
  return `rgba(${rgb},${a})`;
};

const mix3 = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t),
];

function roundRectPath(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number) {
  const r = Math.max(0, Math.min(R, W / 2, H / 2));
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}

function heartPath(x: CanvasRenderingContext2D, s: number) {
  x.beginPath();
  x.moveTo(0, s * 0.38);
  x.bezierCurveTo(-s * 1.05, -s * 0.15, -s * 0.5, -s * 0.95, 0, -s * 0.38);
  x.bezierCurveTo(s * 0.5, -s * 0.95, s * 1.05, -s * 0.15, 0, s * 0.38);
  x.closePath();
}

function starPath(x: CanvasRenderingContext2D, ro: number, ri: number) {
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath();
}

const FONT = `system-ui, "Segoe UI Variable Text", "Segoe UI", sans-serif`;

// ── Dance (BotEngine.applyDance, macOS) ──────────────────────────────────────

/** The dance fades in over 0.3 s and out over 0.5 s. */
export function stepDanceLevel(level: number, dancing: boolean, dt: number): number {
  const target = dancing ? 1 : 0;
  if (level < target) return Math.min(target, level + dt / 0.3);
  if (level > target) return Math.max(target, level - dt / 0.5);
  return level;
}

/**
 * The 112-BPM bounce at `seconds`, for a body of radius R and a dance `level`
 * (0…1): a sideways sway, a hop, a tilt, and a squash on landing.
 */
export function danceTransform(seconds: number, level: number, R: number) {
  const beat = (seconds * 112) / 60;
  const hop = Math.abs(Math.sin(Math.PI * beat));
  const land = Math.pow(1 - hop, 6);
  return {
    dx: 0.08 * R * Math.sin(Math.PI * beat) * level,
    dy: -0.2 * R * hop * level,
    rotate: 0.1 * Math.sin(Math.PI * beat) * level,
    sx: 1 + 0.045 * land * level,
    sy: 1 - 0.06 * land * level,
  };
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class BotEngine {
  isMini = false;
  /** Solid body colour for mini bots / integration pills (null = the variant's own palette). */
  bodyColor: RGB | null = null;
  /**
   * Which Miku is drawn: classic, Snow or Sakura. The wardrobe sets it from the
   * user's choice (or the season); every surface — island, mini bots, desktop,
   * greeting, recap — reads the same engine, so they always agree.
   */
  variant: MikuVariant = MIKU_VARIANTS[DEFAULT_VARIANT];
  /**
   * A new version waits (whats-new/whats-new.ts): while Miku is idle or asleep
   * the up-arrow badge shows. The island turns the body blue alongside.
   */
  private updateHint: RGB | null = null;

  // Animated state (BotEngine `s`)
  yaw = 0; pitch = 0; roll = 0; tilt = 0; open = 1;
  sx = 1; sy = 1; oy = 0; ox = 0;
  tint = 0; morph = 0; hands = 0; blush = 0; es = 1; badgeS = 0;

  // Outfit (the main Mochi only — minis never wear one). `outfit` is what is
  // drawn; it changes only once the previous one has left.
  outfit: Outfit = "none";
  /** 0 = gone, 1 = fully on. */
  outfitPresence = 0;
  private outfitTarget: Outfit = "none";

  // Spring lag of the soft parts (pompoms, hat tips, scarf end), −1…1.
  physDx = 0;
  physDy = 0;
  private physVx = 0;
  private physVy = 0;
  private prevYaw = 0;
  private prevOy = 0;
  private prevRoll = 0;

  // Targets
  tgYaw = 0; tgPitch = 0; tgTilt = 0; tgSy = 1; tgSx = 1; tgEs = 1;

  /** Extra canvas height above the body so hearts can fly out without clipping. */
  particleOverhang = 0;

  /** Dancing to music; `dancingLevel` follows it, 0→1 in 0.3 s, 1→0 in 0.5 s. */
  isDancing = false;
  dancingLevel = 0;

  /** Forced gaze (`glance`): draw loops must hold their own look back meanwhile. */
  glanceUntil = 0;

  /** The mouth rides the voice (`setVoiceLevel`); smoothed in update(). */
  private voiceTarget = 0;
  private voice = 0;

  /** Music loudness (`setMusicEnergy`): the dance bounces with the song, and a
   * bass onset stamps `beatAt` so the hop lands on the beat. */
  musicEnergy = 0;
  private musicRaw = 0;
  private musicTarget = 0;
  private beat = new BeatTracker();
  private beatAt = -10;

  // Mouth spring (fraction of R)
  slotH = 0; slotHTarget = 0; slotHVel = 0; isChewing = false;

  col: RGB = C.idle;
  colT: RGB = C.idle;

  state: BotStateName = "idle";
  cfg: BotStateCfg = BOT_STATES.idle;

  eyeOverride: EyeShape | null = null;
  eyeOverrideUntil = 0;
  permanentEye: EyeShape | null = null;
  permanentEmote: BotEmoteName | null = null;
  miniNextBehavior = 0;

  badge: Badge | null = null;
  private badgeKey = "none";
  private badgeToken = 0;

  private tweens = new Map<PropKey, Tween>();
  private locks = new Set<PropKey>();
  private particles: Particle[] = [];

  // The body outline and the gradients are the same every frame (the palette
  // only changes on setVariant, the morph only while it runs): built once and
  // reused, per canvas, since a gradient belongs to the context that made it.
  private bodyCache: { key: string; path: Path2D } | null = null;
  private gradients = new WeakMap<CanvasRenderingContext2D, GradientCache>();

  lookX = 0;
  lookY = 0;

  lastTime = now();
  private t0 = now() - Math.random() * 5;
  private nextBlink = now() + 1.5 + Math.random() * 2;
  waveUntil = 0;
  waveStart = 0;
  private greetToken = 0;
  private lastAmbient = 0;
  private slapTimes: number[] = [];
  private miniLookTarget = { x: 0, y: 0 };
  private miniLookNextTime = 0;

  /** Fired when three slaps land inside 1.7 s (→ dizzy + confused view). */
  onDizzy: (() => void) | null = null;

  /** Where she stands, as stereo: -1 left … 1 right. The island is 0; the
   * desktop surface sets it from her screen position. */
  pan = 0;

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Draws `id` from now on. Cheap: the next frame picks the new palette up. */
  setVariant(id: MikuVariantId) {
    const v = MIKU_VARIANTS[id];
    if (v && v !== this.variant) this.variant = v;
  }

  /**
   * The launch greeting drives the pose itself (drop, bounce, slide, wave,
   * settle) and hands the result here each frame, so it draws the same Miku with
   * the same eye shapes as everything else instead of its own copy of the face.
   */
  syncGreeting(p: {
    eye: "dot" | "happy" | "content";
    open: number;
    lookX: number;
    lookY: number;
    tint: number;
  }) {
    this.state = "idle";
    this.cfg = BOT_STATES.idle;
    this.permanentEye = null;
    this.eyeOverride = p.eye === "dot" ? "pill" : p.eye === "happy" ? "happy" : "closed";
    this.open = Math.max(0.05, p.open);
    this.lookX = p.lookX;
    this.lookY = p.lookY;
    this.tint = p.tint;
    // The greeting bobs the body through its own transform, so the engine's
    // spring-driven offset stays neutral.
    this.oy = 0;
    this.ox = 0;
    this.tilt = 0;
    this.sx = 1;
    this.sy = 1;
  }

  setState(next: BotStateName, force = false) {
    if (this.state === next && !force) return;
    const prev = this.state;
    this.state = next;
    this.cfg = BOT_STATES[next];
    this.colT = this.cfg.color;
    if (!this.locks.has("tint")) this.tint = this.cfg.tint;
    if (!this.locks.has("tilt")) this.tgTilt = this.cfg.tilt;
    this.setBadge(this.stateBadge());

    switch (next) {
      case "finished":
        this.doRoll(950, 1);
        setTimeout(() => this.emit("spark", 5), 500);
        setTimeout(() => this.celebrate(), 700);
        break;
      case "error":
        this.anim("ox", [
          [0.08, 50, Ease.out], [-0.08, 70, Ease.inOut],
          [0.05, 70, Ease.inOut], [0, 90, Ease.out],
        ]);
        break;
      case "approval":
        this.anim("oy", [[-0.2, 150, Ease.out], [0, 300, Ease.back]]);
        break;
      case "dizzy":
        this.doRoll(1300, 2);
        break;
      case "question":
        this.blink();
        break;
      case "ratelimit":
        this.emit("sweat", 1);
        break;
      default:
        if (prev !== "idle" || next !== "idle") this.blink();
    }
  }

  /** The update badge (blue arrow) while one waits, else nothing. Asked every frame; cheap. */
  setUpdateHint(color: RGB | null) {
    const was = this.updateHint;
    const same = color === was || (color != null && was != null && color.every((c, i) => c === was[i]));
    if (same) return;
    this.updateHint = color;
    this.setBadge(this.stateBadge());
  }

  /** Whether the update hint shows now: only over an idle or sleeping Mochi. */
  get showsUpdateHint(): boolean {
    return this.updateHint != null && (this.state === "idle" || this.state === "sleeping");
  }

  private stateBadge(): Badge | null {
    if (this.showsUpdateHint && this.updateHint) return { kind: "arrow", color: this.updateHint };
    return this.cfg.badge;
  }

  setBadge(b: Badge | null) {
    const key = b ? `${b.kind}-${b.color.join(",")}` : "none";
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    const tok = ++this.badgeToken;
    this.anim("badgeS", [[0, 90, Ease.inOut]]);
    setTimeout(() => {
      if (tok !== this.badgeToken) return;
      this.badge = b;
      if (b) this.anim("badgeS", [[1, 280, Ease.back]]);
    }, 100);
  }

  blink() {
    if (this.locks.has("open")) return;
    this.anim("open", [[0.06, 70, Ease.inOut], [1, 130, Ease.out]]);
  }

  squash() {
    this.physVy += 0.6;
    this.anim("sy", [[0.78, 70, Ease.out], [1.1, 130, Ease.out], [1, 170, Ease.inOut]]);
    this.anim("sx", [[1.16, 70, Ease.out], [0.95, 130, Ease.out], [1, 170, Ease.inOut]]);
  }

  /** Mailbox swallow — opens the slot, chews, then closes. */
  gulp() {
    this.slotHTarget = 0.42;
    setTimeout(() => {
      this.slotHTarget = 0;
      this.isChewing = true;
      setTimeout(() => { this.isChewing = false; }, 800);
    }, 460);
    this.anim("sy", [[0.78, 80, Ease.out], [1.18, 130, Ease.out], [1, 220, Ease.back]]);
    this.anim("sx", [[1.28, 80, Ease.out], [0.92, 130, Ease.out], [1, 220, Ease.back]]);
    this.blink();
  }

  slap() {
    this.interruptGreet();
    if (this.state === "dizzy") return;
    const t = now();
    this.slapTimes = this.slapTimes.filter((s) => t - s < 1.7);
    this.slapTimes.push(t);
    Sound.play("slap", this.pan);
    this.squash();
    this.physVy -= 1.2;
    this.physVx += Math.random() < 0.5 ? 0.7 : -0.7;
    if (this.slapTimes.length >= 3) {
      this.slapTimes = [];
      this.onDizzy?.();
    } else {
      this.eyeOverride = "line";
      this.eyeOverrideUntil = t + 0.8;
      setTimeout(() => Sound.play("annoyed", this.pan), 60);
    }
  }

  doRoll(durationMs: number, turns: number) {
    this.roll = 0;
    this.anim("roll", [[Math.PI * 2 * turns, durationMs, Ease.inOut]], () => { this.roll = 0; });
  }

  /** Peek wave — the "miku". Timings from BotEngine.greet(). */
  greet() {
    const t = now();
    const tok = ++this.greetToken;
    this.waveStart = t + 0.45;
    this.waveUntil = t + 1.55;
    this.physVx += 0.2;

    this.eyeOverride = "happy";
    this.eyeOverrideUntil = t + 2.0;
    this.anim("oy", [[-0.06, 220, Ease.out], [0.0, 220, Ease.back]]);

    setTimeout(() => {
      if (this.greetToken !== tok) return;
      this.anim("hands", [[1, 280, Ease.out]]);
      this.anim("sy", [[0.95, 100, Ease.out], [1.0, 260, Ease.back]]);
      this.anim("sx", [[1.04, 100, Ease.out], [1.0, 260, Ease.back]]);
      Sound.play("greet", this.pan);
    }, 250);

    setTimeout(() => { if (this.greetToken === tok) this.blink(); }, 550);
    setTimeout(() => { if (this.greetToken === tok) this.blink(); }, 1500);
    setTimeout(() => {
      if (this.greetToken !== tok) return;
      this.waveUntil = 0;
      this.anim("hands", [[0, 200, Ease.inOut]]);
    }, 1550);
    setTimeout(() => {
      if (this.greetToken !== tok) return;
      this.eyeOverride = "happy";
      this.eyeOverrideUntil = now() + 0.3;
    }, 1750);
  }

  interruptGreet() {
    if (this.hands <= 0.01 && now() >= this.waveUntil) return;
    this.greetToken++;
    this.waveUntil = 0;
    this.waveStart = 0;
    this.anim("hands", [[0, 150, Ease.inOut]]);
  }

  setPermanentEmote(emote: BotEmoteName | null) {
    this.permanentEmote = emote;
    if (emote === "wink") {
      this.miniNextBehavior = now() + 0.8 + Math.random() * 1.7;
      return;
    }
    this.permanentEye = emote ? EMOTE_EYE[emote] : null;
    if (this.permanentEye) {
      this.eyeOverride = this.permanentEye;
      this.eyeOverrideUntil = Number.POSITIVE_INFINITY;
    } else if (this.eyeOverrideUntil === Number.POSITIVE_INFINITY) {
      this.eyeOverride = null;
      this.eyeOverrideUntil = 0;
    }
    this.miniNextBehavior = now() + 0.8 + Math.random() * 1.7;
  }

  triggerEmote(emote: BotEmoteName, duration = 1.8) {
    const t = now();
    this.eyeOverride = EMOTE_EYE[emote];
    this.eyeOverrideUntil = t + duration;

    switch (emote) {
      case "love":
        this.anim("blush", [
          [1, 300, Ease.out], [1, (duration - 0.6) * 1000, Ease.lin], [0, 300, Ease.inOut],
        ]);
        this.emit("heart", 4);
        this.anim("oy", [[-0.1, 160, Ease.out], [0, 300, Ease.back]]);
        break;
      case "surprised":
        this.anim("oy", [[-0.3, 140, Ease.out], [0, 380, Ease.back]]);
        this.anim("es", [[1.25, 120, Ease.out], [1, 500, Ease.inOut]]);
        break;
      case "proud":
        this.emit("star", 5);
        this.anim("tilt", [
          [-0.14, 220, Ease.out], [-0.14, (duration - 0.5) * 1000, Ease.lin], [0, 280, Ease.inOut],
        ]);
        this.anim("blush", [
          [0.7, 250, Ease.out], [0.7, (duration - 0.5) * 1000, Ease.lin], [0, 300, Ease.inOut],
        ]);
        break;
      case "wink":
        this.anim("tilt", [
          [0.12, 160, Ease.out], [0.12, (duration - 0.4) * 1000, Ease.lin], [0, 240, Ease.inOut],
        ]);
        break;
      case "yawn":
        this.anim("sy", [[1.12, 500, Ease.inOut], [1, 500, Ease.inOut]]);
        this.anim("sx", [[0.94, 500, Ease.inOut], [1, 500, Ease.inOut]]);
        setTimeout(() => { this.eyeOverride = "closed"; this.emit("z", 2); }, 700);
        break;
      case "happy":
        this.anim("blush", [[0.6, 200, Ease.out], [0, 600, Ease.inOut]]);
        break;
      case "annoyed":
        this.eyeOverride = "line";
        this.eyeOverrideUntil = t + 0.8;
        setTimeout(() => Sound.play("annoyed", this.pan), 60);
        break;
    }
  }

  emit(type: Particle["type"], count: number) {
    for (let i = 0; i < count; i++) {
      const isZ = type === "z";
      this.particles.push({
        type,
        x: (Math.random() - 0.5) * 0.9 + (isZ ? 0.55 : 0),
        y: -0.7 - Math.random() * 0.2,
        vx: (Math.random() - 0.5) * 0.35 + (isZ ? 0.18 : 0),
        vy: -(0.45 + Math.random() * 0.35),
        age: -i * 0.14,
        life: 1.3 + Math.random() * 0.5,
        rot: Math.random() * Math.PI * 2,
        size: 0.15 + Math.random() * 0.08,
      });
    }
  }

  /** A little dust where a drag sets her down: sparks kick out at her feet. */
  puff() {
    for (let i = 0; i < 7; i++) {
      this.particles.push({
        type: "spark",
        x: (Math.random() - 0.5) * 0.9,
        y: 0.6 + Math.random() * 0.12,
        vx: (Math.random() - 0.5) * 0.9,
        vy: -(0.1 + Math.random() * 0.2),
        age: -i * 0.03,
        life: 0.5 + Math.random() * 0.3,
        rot: Math.random() * Math.PI * 2,
        size: 0.09 + Math.random() * 0.06,
      });
    }
  }

  animateMorph(target: number, durationMs?: number) {
    const dur = durationMs ?? (target > 0.5 ? 550 : 650);
    this.anim("morph", [[target, dur, Ease.inOut]]);
  }

  resetMorph() {
    this.tweens.delete("morph");
    this.locks.delete("morph");
    this.morph = 0;
  }

  /**
   * Dresses Mochi. Animated: the old outfit leaves (180 ms), the new one drops
   * in (350 ms) and Mochi does a little squash — BotEngine.setOutfit on macOS.
   */
  setOutfit(next: Outfit, animated = true) {
    if (next === this.outfitTarget) return;
    this.outfitTarget = next;
    this.tweens.delete("outfitPresence");
    this.locks.delete("outfitPresence");
    const enter = () => {
      this.outfit = next;
      this.anim("outfitPresence", [[1, 350, Ease.inOut]], () => {
        this.squash();
        this.celebrate();
      });
    };
    if (!animated) {
      this.outfit = next;
      this.outfitPresence = next !== "none" ? 1 : 0;
    } else if (next === "none") {
      this.anim("outfitPresence", [[0, 180, Ease.inOut]], () => { this.outfit = "none"; });
    } else if (this.outfit === "none") {
      this.outfitPresence = 0;
      enter();
    } else {
      this.anim("outfitPresence", [[0, 180, Ease.inOut]], enter);
    }
  }

  /** Wearing something visible: the body then turns as one piece when it rolls. */
  private get rigidRoll(): boolean {
    return !this.isMini && this.outfit !== "none" && this.outfitPresence > 0.05;
  }

  /** True while anything is still moving — lets the island stop its RAF loop. */
  get busy(): boolean {
    return (
      this.tweens.size > 0 ||
      this.particles.length > 0 ||
      this.cfg.bounces || this.cfg.scans || this.cfg.breathes || this.cfg.zz || this.cfg.sweat ||
      this.isMini ||
      this.isDancing || this.dancingLevel > 0.001 ||
      this.voice > 0.004 || this.musicEnergy > 0.01 ||
      Math.abs(this.tgYaw - this.yaw) > 0.002 ||
      Math.abs(this.tgPitch - this.pitch) > 0.002 ||
      Math.abs(this.tgTilt - this.tilt) > 0.002 ||
      Math.abs(this.tgSy - this.sy) > 0.002 ||
      Math.abs(this.tgSx - this.sx) > 0.002 ||
      Math.abs(this.tgEs - this.es) > 0.002 ||
      this.slotH > 0.001 || Math.abs(this.slotHVel) > 0.001 ||
      Math.abs(this.col[0] - this.colT[0]) > 0.003 ||
      Math.abs(this.col[1] - this.colT[1]) > 0.003 ||
      Math.abs(this.col[2] - this.colT[2]) > 0.003 ||
      (this.outfit !== "none" && (Math.abs(this.physVx) > 0.01 || Math.abs(this.physVy) > 0.01))
    );
  }

  // ── Tweens ──────────────────────────────────────────────────────────────────

  anim(prop: PropKey, keys: TweenKey[], onComplete?: () => void) {
    this.tweens.set(prop, {
      prop, keys, index: 0, from: this[prop], startMs: performance.now(), onComplete,
    });
    this.locks.add(prop);
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  update(dt: number) {
    const n = now();
    const nowMs = performance.now();

    for (const tw of [...this.tweens.values()]) {
      const k = tw.keys[tw.index];
      const p = Math.min(1, Math.max(0, (nowMs - tw.startMs) / k[1]));
      this[tw.prop] = tw.from + (k[0] - tw.from) * k[2](p);
      if (p >= 1) {
        tw.from = k[0];
        tw.index += 1;
        tw.startMs = nowMs;
        if (tw.index >= tw.keys.length) {
          this.tweens.delete(tw.prop);
          this.locks.delete(tw.prop);
          tw.onComplete?.();
        }
      }
    }

    const t = n - this.t0;
    let ty = this.lookX * 0.62;
    let tp = this.lookY * 0.5;

    if (this.cfg.look) {
      ty = ty * 0.35 + this.cfg.look[0] * 0.55;
      tp = tp * 0.3 + this.cfg.look[1] * 0.5;
    }
    if (this.cfg.scans) {
      ty = Math.sin(t * 2.6) * 0.6;
      tp = -0.06;
    }
    if (this.state === "sleeping") { ty = 0; tp = -0.14; }
    if (this.state === "dizzy") { ty = Math.sin(t * 9) * 0.25; }

    // Mini bots never follow the mouse — they wander.
    if (this.isMini && !this.cfg.look && !this.cfg.scans && this.state !== "sleeping" && this.state !== "dizzy") {
      if (n > this.miniLookNextTime) {
        this.miniLookTarget = {
          x: -0.88 + Math.random() * 1.76,
          y: -0.55 + Math.random() * 1.0,
        };
        this.miniLookNextTime = n + 0.5 + Math.random() * 1.5;
      }
      ty = this.miniLookTarget.x * 0.62;
      tp = this.miniLookTarget.y * 0.5;
    }

    this.tgYaw = ty;
    this.tgPitch = tp;
    this.tgTilt = this.cfg.tilt;

    if (n > this.waveStart && n < this.waveUntil) {
      const wt = n - this.waveStart;
      this.tgTilt = -0.06 + Math.sin(2 * Math.PI * 1.2 * wt) * 0.07;
    }

    const bounce = this.cfg.bounces ? -Math.abs(Math.sin(t * 5.2)) * 0.07 : 0;
    const kGen = 1 - Math.pow(0.0008, dt);
    if (!this.locks.has("oy")) this.oy += (bounce - this.oy) * kGen;

    if (this.cfg.breathes) {
      const amp = this.isMini ? 0.07 : 0.035;
      this.tgSy = 1 + Math.sin(t * 1.8) * amp;
      this.tgSx = 1 - Math.sin(t * 1.8) * amp * 0.57;
    } else if (this.isMini) {
      this.tgSy = 1 + Math.sin(t * 2.2) * 0.04;
      this.tgSx = 1 - Math.sin(t * 2.2) * 0.02;
    } else {
      this.tgSy = 1;
      this.tgSx = 1;
    }

    if (this.isMini && n > this.miniNextBehavior) this.doMiniBehaviorLoop();

    const kLook = 1 - Math.pow(0.0025, dt);
    if (!this.locks.has("yaw")) this.yaw += (this.tgYaw - this.yaw) * kLook;
    if (!this.locks.has("pitch")) this.pitch += (this.tgPitch - this.pitch) * kLook;
    if (!this.locks.has("tilt")) this.tilt += (this.tgTilt - this.tilt) * kGen;
    if (!this.locks.has("sy")) this.sy += (this.tgSy - this.sy) * kGen;
    if (!this.locks.has("sx")) this.sx += (this.tgSx - this.sx) * kGen;
    if (!this.locks.has("es")) this.es += (this.tgEs - this.es) * kGen;

    this.col = mix3(this.col, this.colT, 1 - Math.pow(0.002, dt));

    // The mouth rides the voice, the dance rides the music: both snappy enough
    // to read as the real thing, smooth enough not to flicker frame to frame.
    const kLive = 1 - Math.pow(0.002, dt);
    this.voice += (this.voiceTarget - this.voice) * kLive;
    this.musicTarget += (this.musicRaw - this.musicTarget) * kLive;
    this.musicEnergy = danceEnergy(this.musicTarget);


    if (n > this.nextBlink) {
      if (this.state !== "sleeping" && this.state !== "dizzy") {
        this.blink();
        if (Math.random() < 0.22) setTimeout(() => this.blink(), 230);
      }
      this.nextBlink = n + 2.2 + Math.random() * 3.2;
    }

    if (this.eyeOverride && n > this.eyeOverrideUntil) {
      this.eyeOverride = this.permanentEye;
      if (this.permanentEye) this.eyeOverrideUntil = Number.POSITIVE_INFINITY;
    }

    if (n - this.lastAmbient > 1.3) {
      this.lastAmbient = n;
      if (this.cfg.zz) this.emit("z", 1);
      if (!this.isMini && this.cfg.sweat && Math.random() < 0.5) this.emit("sweat", 1);
    }

    for (const p of this.particles) p.age += dt;
    this.particles = this.particles.filter((p) => p.age < p.life);

    // Mouth slot spring — ω₀ = 2π/0.25, ζ = 0.6
    const omega = (2 * Math.PI) / 0.25;
    const zeta = 0.6;
    const acc = omega * omega * (this.slotHTarget - this.slotH) - 2 * zeta * omega * this.slotHVel;
    this.slotHVel += acc * dt;
    this.slotH = Math.max(0, this.slotH + this.slotHVel * dt);

    this.dancingLevel = stepDanceLevel(this.dancingLevel, this.isDancing, dt);

    // Soft-part spring: lags behind head turns, hops and rolls (stiffness 60, damping 9).
    if (dt > 0) {
      const yawVel = (this.yaw - this.prevYaw) / dt;
      const oyVel = (this.oy - this.prevOy) / dt;
      // A finished roll snaps from 2π·turns back to 0: that jump is not motion.
      const dRoll = this.roll - this.prevRoll;
      const rollVel = Math.abs(dRoll) > Math.PI ? 0 : dRoll / dt;
      const centrifugal = this.rigidRoll ? rollVel * 0.18 : 0;
      const tDx = Math.max(-1, Math.min(1, -yawVel * 0.35 - this.tilt * 2 + centrifugal));
      const tDy = Math.max(-1, Math.min(1, oyVel * 0.5));
      this.physVx += (60 * (tDx - this.physDx) - 9 * this.physVx) * dt;
      this.physVy += (60 * (tDy - this.physDy) - 9 * this.physVy) * dt;
      this.physDx += this.physVx * dt;
      this.physDy += this.physVy * dt;
    }
    this.prevYaw = this.yaw;
    this.prevOy = this.oy;
    this.prevRoll = this.roll;

    this.lastTime = n;
  }

  private doMiniBehaviorLoop() {
    const n = now();
    switch (this.permanentEmote) {
      case "happy":
        if (this.locks.has("oy")) { this.miniNextBehavior = n + 0.4; return; }
        this.anim("oy", [[-0.3, 120, Ease.out], [0.03, 200, Ease.inOut], [0, 160, Ease.back]]);
        this.anim("sy", [[0.82, 80, Ease.out], [1.18, 130, Ease.out], [0.88, 160, Ease.inOut], [1, 200, Ease.back]]);
        this.anim("sx", [[1.15, 80, Ease.out], [0.88, 130, Ease.out], [1.06, 160, Ease.inOut], [1, 200, Ease.back]]);
        this.miniNextBehavior = n + 2.2 + Math.random() * 1.2;
        break;
      case "annoyed":
        if (this.locks.has("yaw")) { this.miniNextBehavior = n + 0.5; return; }
        this.anim("yaw", [
          [-0.65, 50, Ease.out], [0.65, 90, Ease.inOut], [-0.5, 80, Ease.inOut],
          [0.4, 75, Ease.inOut], [-0.2, 70, Ease.inOut], [0, 140, Ease.out],
        ]);
        this.miniNextBehavior = n + 3.0 + Math.random() * 2.5;
        break;
      case "wink":
        this.eyeOverride = "wink";
        this.eyeOverrideUntil = n + 0.55;
        this.anim("tilt", [[0.13, 100, Ease.out], [0.13, 320, Ease.lin], [0, 200, Ease.inOut]]);
        this.miniNextBehavior = n + 2.2 + Math.random() * 2.0;
        break;
      case "love":
        this.emit("heart", 2);
        this.anim("tilt", [[-0.1, 180, Ease.out], [0.1, 340, Ease.inOut], [0, 220, Ease.inOut]]);
        this.miniNextBehavior = n + 2.6 + Math.random() * 1.5;
        break;
      default:
        this.miniNextBehavior = n + 3.0 + Math.random() * 2.0;
    }
  }

  // ── Dancing ─────────────────────────────────────────────────────────────────

  setDancing(dancing: boolean) {
    if (this.isDancing !== dancing) this.isDancing = dancing;
  }

  /** 1 at the beat, decaying in about a sixth of a second — the island's small
   * chrome (plan dot, clock) breathes with it while she dances. 0 when not. */
  get beatPulse(): number {
    if (!this.isDancing || this.dancingLevel <= 0.001) return 0;
    return Math.exp(-(now() - this.beatAt) * 6);
  }

  /** How loud the current voice is, 0…1: the mouth opens with it while she
   * dictates or answers. 0 holds it shut. */
  setVoiceLevel(v: number) {
    this.voiceTarget = Math.min(1, Math.max(0, v));
  }

  /** The system's music, analysed by Rust (music-bands): the rms drives how
   * hard the dance bounces, a bass onset stamps a beat the hop lands on. */
  setMusicEnergy(rms: number, bass: number) {
    this.musicRaw = Math.min(1, Math.max(0, rms));
    if (this.beat.push(bass)) this.beatAt = now();
  }

  /** Forces the gaze toward (x, y) for `seconds`, whatever the cursor does.
   * The caller's draw loop must hold its own look updates back meanwhile —
   * read `glanceUntil` (the anticipation before an emote, chiefly). */
  glance(x: number, y: number, seconds: number) {
    this.lookX = x;
    this.lookY = y;
    this.glanceUntil = now() + seconds;
  }

  /** A small hello when the pointer first finds her: eyes widen, a light blush. */
  notice() {
    const t = now();
    this.eyeOverride = "wide";
    this.eyeOverrideUntil = t + 0.5;
    this.anim("es", [[1.14, 140, Ease.out], [1, 420, Ease.inOut]]);
    this.anim("blush", [[0.45, 180, Ease.out], [0, 520, Ease.inOut]]);
  }

  /** Task done, new look: a short burst whose confetti follows the variant —
   * petals for Sakura, snow for Snow, hearts and sparks for classic. The
   * falling kinds drift down from above her, the way the variants' own
   * ornaments do. */
  celebrate() {
    if (this.variant.id === "sakura") {
      for (let i = 0; i < 10; i++) this.particles.push({
        type: "petal",
        x: (Math.random() - 0.5) * 2.4,
        y: -0.78 - Math.random() * 0.3,
        vx: (Math.random() - 0.5) * 0.2,
        vy: 0.5 + Math.random() * 0.3,
        age: -i * 0.08,
        life: 1.9 + Math.random() * 0.6,
        rot: Math.random() * Math.PI * 2,
        size: 0.15 + Math.random() * 0.08,
      });
    } else if (this.variant.id === "snow") {
      for (let i = 0; i < 10; i++) this.particles.push({
        type: "snowflake",
        x: (Math.random() - 0.5) * 2.4,
        y: -0.78 - Math.random() * 0.3,
        vx: (Math.random() - 0.5) * 0.15,
        vy: 0.45 + Math.random() * 0.3,
        age: -i * 0.08,
        life: 2.0 + Math.random() * 0.6,
        rot: Math.random() * Math.PI * 2,
        size: 0.14 + Math.random() * 0.07,
      });
    } else {
      this.emit("heart", 3);
      this.emit("spark", 6);
    }
  }

  /**
   * Applies the dance bounce and sway around the bottom of the body. Call it on
   * a saved context, before draw(), with the same size (BotEngine.applyDance).
   * With music playing the hop rides the song: louder bounces higher, and a
   * bass onset adds a kick that decays in a sixth of a second. The system
   * asking for less motion keeps a gentle sway and drops the kick.
   */
  applyDance(x: CanvasRenderingContext2D, W: number, H: number) {
    if (this.dancingLevel <= 0.001) return;
    const R = W * 0.3;
    const px = W / 2 + this.ox * R;
    const py = H / 2 + this.particleOverhang / 2 + this.oy * R + R * 0.06 + R * 0.88;
    const gentle = reducedMotion();
    const level = this.dancingLevel * (gentle ? 0.35 : 1);
    const d = danceTransform(now(), level, R);
    const boost = gentle ? 1 : 1 + this.musicEnergy * 0.9 + Math.exp(-(now() - this.beatAt) * 6) * 0.4;
    x.translate(px + d.dx, py + d.dy * boost);
    x.rotate(d.rotate);
    x.scale(d.sx, d.sy);
    x.translate(-px, -py);
  }

  // ── Draw ────────────────────────────────────────────────────────────────────

  /**
   * Draws hands, body, blush, eyes, mouth, badge and particles into a canvas of
   * `w`×`h` CSS pixels (the caller has already applied the DPR transform).
   */
  draw(x: CanvasRenderingContext2D, W: number, H: number) {
    const R = W * 0.3;
    const rx = R * 1.14;
    const ry = R * 0.88;
    const cx = W / 2 + this.ox * R;
    const cy = H / 2 + this.particleOverhang / 2 + this.oy * R + R * 0.06;

    // With an outfit on, a roll turns the whole character — hat included — as
    // one piece instead of rolling the eyes over the body (BotCanvasView, macOS).
    x.save();
    if (this.rigidRoll && Math.abs(this.roll) > 0.001) {
      x.translate(cx, cy);
      x.rotate(this.roll);
      x.translate(-cx, -cy);
    }

    this.drawHandsBehind(x, R, rx, ry, cx, cy);

    x.save();
    x.translate(cx, cy);
    if (this.tilt !== 0) x.rotate(this.tilt);
    x.scale(this.sx, this.sy);

    // Outfits are anchored to the chibi's own head. The hat and glasses code in
    // outfits.ts was written for a head ellipse centred on the body centre with
    // radii (R·1.14, R·0.88); Miku's head is the hair cap at (150, 64) in the
    // 0..300 prototype space, 88×80. So the context is moved up to that centre
    // and the head is given those radii: a hat then sits on the crown instead of
    // floating over the body. Minis never wear one.
    const u = R / 158;
    const headY = -(150 - 64) * u;
    const head = this.isMini ? null : dressedHead(u, this.yaw, this.pitch, this.physDx, this.physDy);
    const outfitState = { presence: this.outfitPresence, morph: this.morph };
    if (head) {
      x.save();
      x.translate(0, headY);
      drawOutfitBehind(x, this.outfit, head, outfitState);
      x.restore();
    }

    const body = this.bodyPath(rx, ry, R);
    this.drawBody(x, body, R, rx, ry);

    const blushVal = Math.max(this.blush, this.tint * 0.5) * (1 - this.morph);
    if (blushVal > 0.01) {
      x.save();
      x.clip(body);
      x.fillStyle = `rgba(255,150,170,${0.45 * blushVal})`;
      for (const sd of [-1, 1]) {
        x.beginPath();
        x.ellipse(sd * R * 0.32, -R * 0.26, R * 0.09, R * 0.055, 0, 0, Math.PI * 2);
        x.fill();
      }
      x.restore();
    }

    this.drawEyes(x, body, R, rx, ry);
    this.drawMikuFront(x, R, rx, ry);

    if (head) {
      x.save();
      x.translate(0, headY);
      drawOutfitFront(x, this.outfit, head, outfitState);
      x.restore();
    }

    x.restore();
    x.restore();

    if (this.badge && this.badgeS > 0.01 && this.morph < 0.25) {
      this.drawBadge(x, this.badge, R, cx, cy);
    }
    this.drawParticles(x, R, cx, cy);
  }

  private bodyPath(rx: number, ry: number, R: number): Path2D {
    // While the mailbox morph runs the outline is a different shape every
    // frame; at rest it only changes with the canvas size.
    const m = this.morph;
    const still = m < 0.005;
    const key = `${rx}|${ry}|${R}`;
    if (still && this.bodyCache?.key === key) return this.bodyCache.path;

    const n = 72;
    const expN = 2.0 / 2.7;
    const tw = R * 1.0;
    const th = R * 0.94;
    const tr = R * 0.42;
    const p = new Path2D();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const px0 = rx * (ca >= 0 ? Math.pow(ca, expN) : -Math.pow(-ca, expN));
      const py0 = ry * (sa >= 0 ? Math.pow(sa, expN) : -Math.pow(-sa, expN));
      let px = px0;
      let py = py0;
      if (!still) {
        const rr = rrPoint(ca, sa, tw, th, tr);
        px = lerp(px0, rr.x, m);
        py = lerp(py0, rr.y, m);
      }
      if (i === 0) p.moveTo(px, py);
      else p.lineTo(px, py);
    }
    p.closePath();
    if (still) this.bodyCache = { key, path: p };
    return p;
  }

  /** The cached gradients of `x` for the variant drawn now, made on first use. */
  private gradientCache(x: CanvasRenderingContext2D): GradientCache {
    const held = this.gradients.get(x);
    if (held && held.variant === this.variant) return held;
    const fresh: GradientCache = { variant: this.variant, iris: new Map() };
    this.gradients.set(x, fresh);
    return fresh;
  }

  /** The whole chibi, back layer to body; the face is drawEyes, the front hair
   *  and the ornaments drawMikuFront. All coordinates are the 0..300 prototype
   *  space, the character centred on (150, ~150), one system with no translate. */
  private drawBody(x: CanvasRenderingContext2D, _body: Path2D, R: number, _rx: number, _ry: number) {
    const u = R / 158;
    const t = now();
    const state = this.state;
    const tint = Math.min(1, this.tint);
    const v = this.variant;
    x.save();
    x.scale(u, u);
    x.translate(-150, -150);

    if (this.isMini) {
      // Mini bot: head only, the pill's colour melting into the hair.
      const hair = this.bodyColor ? mixRGB(v.hair, this.bodyColor, 0.62) : v.hair;
      x.fillStyle = rgba(hair);
      x.beginPath(); x.ellipse(150, 64, 88, 80, 0, 0, Math.PI * 2); x.fill();
      this.mikuHeadMass(x, hair);
      x.restore();
      return;
    }

    const sway = this.isDancing ? Math.sin(t * 6) * 6
      : state === "dizzy" ? Math.sin(t * 9) * 5 : Math.sin(t * 1.6) * 1.8;

    // Whatever only this variant has, behind the body: Snow's snowflakes.
    v.extra?.behind?.(x, v, t);

    // ── back hair: the cap, then the two twin-tails ──
    const gc = this.gradientCache(x);
    if (!gc.hair) {
      const hg = x.createLinearGradient(0, 10, 0, 260);
      hg.addColorStop(0, rgba(v.hair));
      hg.addColorStop(1, rgba(v.hairDark));
      gc.hair = hg;
    }
    x.fillStyle = gc.hair;
    x.beginPath(); x.ellipse(150, 64, 88, 80, 0, 0, Math.PI * 2); x.fill();

    // Twin-tails: Miku's signature. Each is gathered high at the side of the
    // head, swells outward past the shoulder and tapers to a point near the hem.
    // They sway with the dance, so they read as hair and not as a cape: the
    // outer edge is drawn first, then a lighter inner mass on top of it, which
    // is what gives the tail a rounded volume instead of a flat drape.
    for (const s of [-1, 1]) {
      const sd = s * sway;
      (x as CanvasRenderingContext2D).save();
      // The mass of one tail, from a scale of x (right/left of centre).
      const tail = (k: number) => {
        x.beginPath();
        x.moveTo(150 + s * (62 * k) + sd * 0.35, 56);
        x.bezierCurveTo(
          150 + s * (104 * k) + sd * 0.7, 74,
          150 + s * (126 * k) + sd, 128,
          150 + s * (124 * k) + sd, 186,
        );
        x.bezierCurveTo(
          150 + s * (122 * k) + sd, 232,
          150 + s * (112 * k) + sd, 268,
          150 + s * (96 * k) + sd, 292,
        );
        // The inner edge climbs back up, tucking behind the shoulder and the
        // jaw. It runs well inside the torso (x≈100) so the tail and the body
        // overlap: a gap here would show the background as a dark wedge.
        x.bezierCurveTo(
          150 + s * (58 * k) + sd * 0.7, 256,
          150 + s * (44 * k) + sd * 0.6, 176,
          150 + s * (56 * k) + sd * 0.4, 96,
        );
        x.closePath();
      };
      // Outer mass, in the darker shade.
      if (!gc.tails) {
        const make = (dir: number) => {
          const g = x.createLinearGradient(150 + dir * 40, 60, 150 + dir * 100, 280);
          g.addColorStop(0, rgba(v.hair));
          g.addColorStop(1, rgba(v.hairDark));
          return g;
        };
        gc.tails = [make(-1), make(1)];
      }
      x.fillStyle = gc.tails[s < 0 ? 0 : 1];
      tail(1);
      x.fill();
      // Inner mass, lighter and narrower: the highlight that rounds it out.
      x.globalAlpha = 0.55;
      x.fillStyle = rgba(v.hair);
      tail(0.72);
      x.fill();
      x.globalAlpha = 1;
      // The tie: the band that gathers the tail, near the top.
      x.fillStyle = rgba(v.hairDark);
      x.beginPath();
      x.ellipse(150 + s * 70, 66, 13, 17, s * 0.3, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = "rgba(255,255,255,0.3)";
      x.beginPath();
      x.ellipse(150 + s * 70, 62, 8, 10, s * 0.3, 0, Math.PI * 2);
      x.fill();
      x.restore();
    }

    // ── the body: white shirt, teal tie, pleated skirt ──
    // Shirt first, so the skirt and the sleeves sit on it.
    const shirt = mixRGB(v.shirt, this.col, tint * 0.34);
    x.fillStyle = rgba(shirt);
    x.beginPath();
    x.moveTo(150 - 44, 126);
    x.quadraticCurveTo(150 - 54, 172, 150 - 46, 196);
    x.lineTo(150 + 46, 196);
    x.quadraticCurveTo(150 + 54, 172, 150 + 44, 126);
    x.quadraticCurveTo(150, 140, 150 - 44, 126);
    x.closePath();
    x.fill();

    // Skirt: a modest A-line, grey pleats and a pale hem. It starts under the
    // shirt and stops inside the shoulder line, so the silhouette stays narrow
    // at the top and the twin-tails remain the widest thing on the character.
    let sg = gc.skirt;
    if (!sg) {
      sg = x.createLinearGradient(0, 186, 0, 254);
      sg.addColorStop(0, rgba(v.skirt));
      sg.addColorStop(1, rgba(v.skirtShade));
      gc.skirt = sg;
    }
    x.fillStyle = sg;
    x.beginPath();
    x.moveTo(150 - 40, 188);
    x.quadraticCurveTo(150 - 54, 224, 150 - 52, 248);
    x.quadraticCurveTo(150, 259, 150 + 52, 248);
    x.quadraticCurveTo(150 + 54, 224, 150 + 40, 188);
    x.closePath();
    x.fill();
    // Pleats: a few darker creases, longer in the middle.
    x.strokeStyle = "rgba(0,0,0,0.16)";
    x.lineWidth = 2;
    for (const px of [-26, -13, 0, 13, 26]) {
      x.beginPath();
      x.moveTo(150 + px * 0.86, 190);
      x.lineTo(150 + px * 1.06, 246 - Math.abs(px) * 0.16);
      x.stroke();
    }
    x.strokeStyle = rgba(v.trim, 0.95);
    x.lineWidth = 3.4;
    x.beginPath();
    x.moveTo(150 - 51, 244);
    x.quadraticCurveTo(150, 255, 150 + 51, 244);
    x.stroke();

    // ── legs ──
    // Below the skirt, so the chibi is a whole figure and not a bust: a sliver
    // of thigh, then the black thigh-highs Miku wears. The thigh starts up
    // inside the skirt's hem (y≈244) so no gap shows between them.
    for (const s of [-1, 1]) {
      const lx = 150 + s * 20;
      x.fillStyle = rgba(v.skin);
      x.beginPath();
      x.ellipse(lx, 246, 12, 14, 0, 0, Math.PI * 2);
      x.fill();
      // The stockings, from just under the hem down to the ankle.
      x.fillStyle = rgba(v.gloves);
      x.beginPath();
      x.moveTo(lx - 12, 248);
      x.quadraticCurveTo(lx - 10, 274, lx - 9, 284);
      x.lineTo(lx + 9, 284);
      x.quadraticCurveTo(lx + 10, 274, lx + 12, 248);
      x.closePath();
      x.fill();
      // The band at the top of the stocking.
      x.fillStyle = "rgba(255,255,255,0.22)";
      x.beginPath();
      x.ellipse(lx, 250, 12, 3.4, 0, 0, Math.PI * 2);
      x.fill();
      // The shoe.
      x.fillStyle = rgba(v.gloves);
      x.beginPath();
      x.ellipse(lx + s * 1.5, 288, 13, 7, 0, 0, Math.PI * 2);
      x.fill();
    }

    // ── arms ──
    // The left arm is the one with the "01"; the right one carries the pose.
    x.fillStyle = rgba(shirt);
    if (state === "working") {
      x.beginPath(); x.ellipse(150 - 30, 172, 16, 30, 0.4, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(150 + 30, 172, 16, 30, -0.4, 0, Math.PI * 2); x.fill();
      // Black forearm sleeves, both hands on the keyboard.
      x.fillStyle = rgba(v.gloves);
      x.beginPath(); x.ellipse(150 - 16, 196, 11, 12, 0.2, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(150 + 16, 196, 11, 12, -0.2, 0, Math.PI * 2); x.fill();
      x.fillStyle = rgba(v.skin);
      x.beginPath(); x.ellipse(150, 204, 12, 6, 0, 0, Math.PI * 2); x.fill();
    } else {
      x.beginPath(); x.ellipse(150 - 34, 168, 17, 34, 0.35, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(150 + 50, 172, 15, 30, -0.5, 0, Math.PI * 2); x.fill();
      // The left forearm sleeve, the black band Miku wears under the "01".
      x.fillStyle = rgba(v.gloves);
      x.beginPath(); x.ellipse(150 - 41, 192, 11, 13, 0.32, 0, Math.PI * 2); x.fill();
      x.fillStyle = rgba(v.skin);
      x.beginPath(); x.ellipse(150 - 35, 202, 7, 6.5, 0, 0, Math.PI * 2); x.fill();
      // The right hand, resting in front of the skirt.
      x.fillStyle = rgba(v.gloves);
      x.beginPath(); x.ellipse(150 + 62, 199, 9, 8, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = rgba(v.skin);
      x.beginPath(); x.ellipse(150 + 73, 205, 7.5, 6.5, 0, 0, Math.PI * 2); x.fill();
    }
    if (!this.isMini) armband(x, v.armband, v.trim);

    // ── collar and tie ──
    // A winter outfit closes with a fur collar instead of an open neckline.
    if (v.furCollar) {
      x.fillStyle = rgba(v.trim);
      x.beginPath();
      x.moveTo(150 - 50, 132);
      x.quadraticCurveTo(150, 116, 150 + 50, 132);
      x.quadraticCurveTo(150, 156, 150 - 50, 132);
      x.closePath();
      x.fill();
      // The fur itself: small overlapping puffs along the band.
      x.fillStyle = "rgba(255,255,255,0.97)";
      for (let i = -4; i <= 4; i++) {
        const px = 150 + i * 12.5;
        const py = 133 - Math.cos((i / 4) * (Math.PI / 2)) * 8;
        x.beginPath();
        x.arc(px, py, 9.5, 0, Math.PI * 2);
        x.fill();
      }
      x.fillStyle = "rgba(214,232,248,0.85)";
      for (let i = -3; i <= 3; i++) {
        x.beginPath();
        x.arc(150 + i * 16, 141, 5.5, 0, Math.PI * 2);
        x.fill();
      }
    }

    // The collar is the shirt's, in trim; the tie is Miku's colour.
    x.fillStyle = rgba(v.trim);
    x.beginPath(); x.moveTo(150 - 18, 128);
    x.lineTo(150, 146); x.lineTo(150 + 18, 128);
    x.quadraticCurveTo(150, 138, 150 - 18, 128);
    x.closePath();
    x.fill();
    x.fillStyle = rgba(v.tie);
    // The knot, then the two blades.
    x.beginPath(); x.moveTo(150, 143); x.lineTo(150 - 6, 150); x.lineTo(150, 157); x.lineTo(150 + 6, 150);
    x.closePath(); x.fill();
    x.beginPath();
    x.moveTo(150 - 5, 156);
    x.quadraticCurveTo(150 - 10, 176, 150 - 7, 190);
    x.lineTo(150 + 7, 190);
    x.quadraticCurveTo(150 + 10, 176, 150 + 5, 156);
    x.closePath();
    x.fill();

    // ── head: face, bangs, side locks ──
    this.mikuHeadMass(x, v.hair);
    x.restore();
  }

  /** Face, bangs and side locks — used by the full chibi and the mini bot. */
  private mikuHeadMass(x: CanvasRenderingContext2D, hair: RGB) {
    const v = this.variant;
    x.fillStyle = rgba(v.skin);
    x.beginPath(); x.ellipse(150, 76, 64, 60, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = rgba(hair);
    // Bangs: the same five-lobe fringe, a touch flatter than the old chibi's —
    // Miku's is cut straight across, not parted.
    for (let i = -2; i <= 2; i++) {
      x.save(); x.translate(150 + i * 27, 36 + Math.abs(i) * 2); x.rotate(i * 0.04);
      x.beginPath(); x.ellipse(0, 0, 25, 26, 0, 0, Math.PI * 2); x.fill();
      x.restore();
    }
    x.fillStyle = v.hairHi; x.globalAlpha = 0.6;
    x.beginPath(); x.ellipse(116, 24, 6, 15, 0.25, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(182, 22, 5.5, 14, -0.2, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;
    // Side locks, shorter than the old chibi's: they stop at the jaw.
    x.fillStyle = rgba(v.hairDark);
    x.beginPath(); x.ellipse(84, 96, 13, 48, 0.08, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(216, 96, 13, 48, -0.08, 0, Math.PI * 2); x.fill();
  }

  /** Wajah Miku: alis, mata (half-lidded stoic + emote), mulut, kacamata. */
  private drawEyes(x: CanvasRenderingContext2D, _body: Path2D, R: number, _rx: number, _ry: number) {
    let shape: EyeShape = this.eyeOverride ?? this.cfg.eye;
    if (this.isDancing && this.dancingLevel > 0.15 && !this.isMini && (this.state === "idle" || this.state === "finished")) {
      shape = "happy";
    }
    const u = R / 158;
    const state = this.state;
    const ink = this.isMini ? MINI_INK : this.variant.eyeInk;
    const es = this.es;
    const blink = this.open < 0.22;

    x.save();
    x.scale(u, u);
    x.translate(-150, -150);

    // alis — rata, ujung dalam sedikit naik (meek)
    x.strokeStyle = ink; x.lineWidth = 2.2; x.lineCap = "round";
    const browLift = shape === "happy" ? -2.5 : 0;
    for (const sd of [-1, 1]) {
      const bx = 150 + sd * 30 + this.lookX * 4;
      x.beginPath();
      x.moveTo(bx - sd * 8, 59.5 + browLift);
      x.quadraticCurveTo(bx, 61.5 + browLift, bx + sd * 8, 61 + browLift);
      x.stroke();
    }

    const eye = (sd: number, mode: "normal" | "happy" | "closed" | "tired" | "flat" | "dot" | "x" | "heart" | "star" | "wink") => {
      const EW = 13 * es, EH = 19 * es;
      const ex = 150 + sd * 30 + this.lookX * 4;
      const ey = 88 + this.lookY * 3 + 1.5;
      if (mode === "closed" || (mode === "wink" && sd > 0)) {
        x.strokeStyle = ink; x.lineWidth = 3;
        x.beginPath(); x.moveTo(ex - 8, ey); x.quadraticCurveTo(ex, ey + 4.5, ex + 8, ey); x.stroke();
        return;
      }
      if (mode === "happy") {
        x.strokeStyle = ink; x.lineWidth = 3.6; x.lineCap = "round";
        x.beginPath(); x.arc(ex, ey + 5.5, 10, Math.PI * 1.15, Math.PI * 1.85); x.stroke();
        return;
      }
      if (mode === "x") {
        x.strokeStyle = ink; x.lineWidth = 3.4; x.lineCap = "round";
        x.beginPath(); x.moveTo(ex - 9, ey - 9); x.lineTo(ex + 9, ey + 9);
        x.moveTo(ex + 9, ey - 9); x.lineTo(ex - 9, ey + 9); x.stroke();
        return;
      }
      if (mode === "flat" || mode === "tired") {
        x.fillStyle = ink;
        roundRectPath(x, ex - 11, ey - 2, 22, 5, 2.5); x.fill();
        return;
      }
      // The iris: a gradient, light at the top and dark at the bottom. Its
      // ends follow the gaze (ey) and the surprise (es), so it is kept per
      // rounded pair rather than rebuilt for every eye of every frame.
      const irisKey = (Math.round(ey * 2) << 8) | Math.round(es * 100);
      const gc = this.gradientCache(x);
      let iris = gc.iris.get(irisKey);
      if (!iris) {
        iris = x.createLinearGradient(0, ey - EH, 0, ey + EH);
        iris.addColorStop(0, rgba(this.variant.eye1));
        iris.addColorStop(1, rgba(this.variant.eye2));
        if (gc.iris.size > 64) gc.iris.clear();
        gc.iris.set(irisKey, iris);
      }
      x.fillStyle = iris;
      x.beginPath(); x.ellipse(ex, ey, EW, EH, 0, 0, Math.PI * 2); x.fill();
      x.strokeStyle = ink; x.lineWidth = 1.9;
      x.beginPath(); x.ellipse(ex, ey, EW, EH, 0, 0, Math.PI * 2); x.stroke();
      if (mode === "heart") {
        x.fillStyle = "#FF4D6D";
        x.save(); x.translate(ex, ey + 1); heartPath(x, EW * 1.1); x.fill(); x.restore();
      } else if (mode === "star") {
        x.fillStyle = "#F7B32B";
        x.save(); x.translate(ex, ey); x.rotate(now() * 1.5 * sd); starPath(x, EW * 0.95, EW * 0.42); x.fill(); x.restore();
      } else if (mode === "dot") {
        x.fillStyle = ink;
        x.beginPath(); x.arc(ex, ey, EW * 0.42, 0, Math.PI * 2); x.fill();
      }
      // kelopak atas menutup ~1/3 iris — tatapan tenang (tired berhenti di cabang flat di atas)
      const lidH = EH * 0.62;
      x.fillStyle = rgba(this.variant.skin);
      x.fillRect(ex - EW - 3, ey - EH - 6, (EW + 3) * 2, lidH);
      x.strokeStyle = ink; x.lineWidth = 3.4;
      const lidY = ey - EH + lidH;
      x.beginPath(); x.moveTo(ex - EW, lidY); x.quadraticCurveTo(ex, lidY - 4, ex + EW, lidY); x.stroke();
      x.fillStyle = "#fff";
      x.beginPath(); x.ellipse(ex - 3, ey + 2.5, 2.5, 3.2, 0, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(ex + 4, ey + 7.5, 1.4, 1.8, 0, 0, Math.PI * 2); x.fill();
      x.strokeStyle = ink; x.lineWidth = 2.4;
      x.beginPath(); x.moveTo(ex + sd * 11, lidY + 5); x.lineTo(ex + sd * 18, lidY); x.stroke();
      x.beginPath(); x.moveTo(ex + sd * 12, lidY + 10); x.lineTo(ex + sd * 20, lidY + 8); x.stroke();
    };

    for (const sd of [-1, 1]) {
      const base = shape === "pill" || shape === "wide" || shape === "cup" ? "normal"
        : shape === "spiral" ? "x" : shape;
      eye(sd, blink && base === "normal" ? "closed"
        : base as "happy" | "closed" | "tired" | "flat" | "dot" | "heart" | "star" | "wink");
    }

    // mulut — hemat ekspresi, khas Mai
    x.strokeStyle = ink; x.lineWidth = 2.6; x.lineCap = "round";
    if (this.isChewing) {
      x.beginPath(); x.arc(146, 118.5, 4, 0.1 * Math.PI, 0.9 * Math.PI);
      x.arc(154, 118.5, 4, 0.1 * Math.PI, 0.9 * Math.PI); x.stroke();
    } else if (this.voice > 0.04 && state !== "sleeping" && state !== "dizzy") {
      // Berkata-kata: mulut membuka mengikuti suara (dictation, OK Miku).
      const h = 1.2 + this.voice * 5.2, w = 3.4 + this.voice * 2.6;
      x.fillStyle = ink;
      x.beginPath();
      x.ellipse(150, 121, w, h, 0, 0, Math.PI * 2);
      x.fill();
    } else if (shape === "happy" || state === "finished" || state === "dancing" as BotStateName) {
      x.beginPath(); x.arc(150, 120, 9, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
    } else if (state === "sleeping") {
      x.beginPath(); x.moveTo(145, 121); x.quadraticCurveTo(150, 125, 155, 121); x.stroke();
    } else if (state === "dizzy") {
      x.beginPath();
      for (let i = 0; i <= 10; i++) { const px = 140 + i * 2, py = 120 + (i % 2 ? -1.8 : 1.8); i ? x.lineTo(px, py) : x.moveTo(px, py); }
      x.stroke();
    } else if (state === "error") {
      x.beginPath(); x.arc(150, 126, 5, 1.15 * Math.PI, 1.85 * Math.PI); x.stroke();
    } else {
      x.beginPath(); x.moveTo(146.5, 120.5); x.lineTo(153.5, 120.5); x.stroke();
    }

    // kacamata bulat (state working)
    if (state === "working" && !this.isMini) {
      x.strokeStyle = "#22d3ee"; x.lineWidth = 3; x.globalAlpha = 0.92;
      for (const sd of [-1, 1]) {
        x.beginPath(); x.arc(150 + sd * 30 + this.lookX * 4, 88, 19, 0, Math.PI * 2); x.stroke();
      }
      x.beginPath(); x.moveTo(139, 88); x.quadraticCurveTo(150, 84, 161, 88); x.stroke();
      x.beginPath(); x.moveTo(101, 88); x.lineTo(86, 83); x.stroke();
      x.beginPath(); x.moveTo(199, 88); x.lineTo(214, 83); x.stroke();
      x.globalAlpha = 1;
    }

    x.restore();
  }

  /** The front-most layer: headset, ahoge, the laptop, and the variant's own ornaments. */
  private drawMikuFront(x: CanvasRenderingContext2D, R: number, _rx: number, _ry: number) {
    if (this.isMini) return;
    const u = R / 158;
    const t = now();
    const state = this.state;
    const v = this.variant;
    x.save();
    x.scale(u, u);
    x.translate(-150, -150);

    // The headset: a small earpiece clamped to the side of the head, with the
    // mic boom. Kept narrow and mostly off the face — a big ring there reads as
    // a monocle rather than an earpiece.
    x.save();
    x.strokeStyle = rgba(v.headset);
    x.lineWidth = 4.5;
    x.beginPath();
    x.ellipse(150 + 84, 84, 9, 12, -0.1, 0, Math.PI * 2);
    x.stroke();
    x.fillStyle = "rgba(255,255,255,0.24)";
    x.beginPath();
    x.ellipse(150 + 84, 84, 5.5, 8, -0.1, 0, Math.PI * 2);
    x.fill();
    x.restore();
    micBoom(x, v.headset);

    // Ahoge — the one strand that never lies flat; it follows the dance.
    const sway = state === "dizzy" ? Math.sin(t * 9) * 8
      : this.isDancing ? Math.sin(t * 6) * 11 : Math.sin(t * 1.8) * 2;
    x.strokeStyle = rgba(v.hairDark); x.lineWidth = 3.4; x.lineCap = "round";
    x.beginPath(); x.moveTo(150, 12);
    x.quadraticCurveTo(152, -4, 158 + sway, -9);
    x.quadraticCurveTo(168 + sway * 1.5, -10, 164 + sway * 1.6, 2);
    x.stroke();

    if (state === "working") {
      // A laptop in the lap, plus the little error bolt.
      x.fillStyle = INK;
      roundRectPath(x, 110, 186, 80, 44, 8); x.fill();
      x.fillStyle = rgba(v.tie); x.globalAlpha = 0.85;
      for (let i = 0; i < 3; i++) x.fillRect(118, 198 + i * 9, 44, 4);
      x.globalAlpha = 1;
      if ((t % 1.2) < 0.5) {
        x.fillStyle = "#fde047";
        x.beginPath(); x.moveTo(210, 146); x.lineTo(198, 194); x.lineTo(210, 194);
        x.lineTo(198, 240); x.lineTo(226, 184); x.lineTo(211, 184); x.lineTo(223, 146);
        x.closePath(); x.fill();
      }
    }

    // Whatever only this variant wears, over the face: Snow's snowflakes,
    // Sakura's blossoms and petals.
    v.extra?.front?.(x, v, t);

    x.restore();
  }

  /** The moe-sleeve hands stay hidden; a greeting is a nod and a head tilt. */
  private drawHandsBehind(
    _x: CanvasRenderingContext2D,
    _R: number, _rx: number, _ry: number, _cx: number, _cy: number,
  ) {
    return;
  }

  private drawBadge(x: CanvasRenderingContext2D, badge: Badge, R: number, cx: number, cy: number) {
    const bs = this.badgeS * (this.isMini ? 1.25 : 1);
    const bx = cx - R * 0.72 * this.sx;
    const by = cy - R * 0.72 * this.sy;
    const t = now();

    x.save();
    x.translate(bx, by);
    x.scale(bs, bs);
    const col = rgba(badge.color);

    if (badge.kind === "dots") {
      if (this.isMini) {
        const phase = (t * 2.4) % 1;
        const dotR = R * 0.22 * (1 + 0.25 * Math.sin(phase * Math.PI * 2));
        x.fillStyle = "#000";
        x.beginPath();
        x.arc(0, 0, R * 0.2, 0, Math.PI * 2);
        x.fill();
        x.fillStyle = col;
        x.beginPath();
        x.arc(0, 0, dotR, 0, Math.PI * 2);
        x.fill();
      } else {
        const pw = R * 0.72;
        const ph = R * 0.36;
        roundRectPath(x, -pw / 2, -ph / 2, pw, ph, ph / 2);
        x.fillStyle = col;
        x.fill();
        for (let i = 0; i < 3; i++) {
          const phase = (((t * 2.4 - i * 0.22) % 1) + 1) % 1;
          const dotR = R * 0.055 * (1 + 0.4 * Math.max(0, Math.sin(phase * Math.PI * 2)));
          x.fillStyle = "#fff";
          x.beginPath();
          x.arc((i - 1) * R * 0.18, 0, dotR, 0, Math.PI * 2);
          x.fill();
        }
      }
    } else if (badge.kind === "arrow") {
      // The "!" badge's ring and disc, with a white up-arrow: a new Miku is out.
      x.fillStyle = "#000";
      x.beginPath();
      x.arc(0, 0, R * 0.3, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = col;
      x.beginPath();
      x.arc(0, 0, R * 0.23, 0, Math.PI * 2);
      x.fill();
      if (!this.isMini) {
        const a = R * 0.12;
        x.strokeStyle = "#fff";
        x.lineWidth = R * 0.055;
        x.lineCap = "round";
        x.lineJoin = "round";
        x.beginPath();
        x.moveTo(0, a);
        x.lineTo(0, -a);
        x.moveTo(-a * 0.8, -a * 0.2);
        x.lineTo(0, -a);
        x.lineTo(a * 0.8, -a * 0.2);
        x.stroke();
      }
    } else if (badge.kind === "bang" || badge.kind === "question") {
      x.fillStyle = "#000";
      x.beginPath();
      x.arc(0, 0, R * 0.3, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = col;
      x.beginPath();
      x.arc(0, 0, R * 0.23, 0, Math.PI * 2);
      x.fill();
      if (!this.isMini) {
        x.fillStyle = "#fff";
        x.font = `900 ${R * 0.32}px ${FONT}`;
        x.textAlign = "center";
        x.textBaseline = "middle";
        x.fillText(badge.kind === "bang" ? "!" : "?", 0, R * 0.02);
      }
    } else {
      x.fillStyle = "#000";
      x.beginPath();
      x.arc(0, 0, R * 0.2, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = col;
      x.beginPath();
      x.arc(0, 0, R * 0.135, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }

  private drawParticles(x: CanvasRenderingContext2D, R: number, cx: number, cy: number) {
    for (const p of this.particles) {
      if (p.age <= 0) continue;
      const k = p.age / p.life;
      const a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      const px = cx + (p.x + p.vx * p.age) * R * 1.3;
      const py = cy + (p.y + p.vy * p.age) * R * 1.3;
      const sz = R * p.size * (1 + k * 0.4);

      x.save();
      x.translate(px, py);
      x.globalAlpha = Math.min(1, Math.max(0, a));
      switch (p.type) {
        case "heart":
          x.rotate(Math.sin(p.age * 6) * 0.3);
          x.fillStyle = "#FF4D6D";
          heartPath(x, sz);
          x.fill();
          break;
        case "star":
          x.rotate(p.rot + p.age * 2);
          x.fillStyle = "#F7B32B";
          starPath(x, sz, sz * 0.45);
          x.fill();
          break;
        case "spark":
          x.rotate(p.rot);
          x.fillStyle = "#fff";
          starPath(x, sz * 0.8, sz * 0.18);
          x.fill();
          break;
        case "petal":
          // Kelopak sakura: pipih, buyar tertiup angin.
          x.rotate(p.rot + Math.sin(p.age * 3) * 0.6);
          x.fillStyle = "#F9B7D0";
          x.beginPath();
          x.ellipse(0, 0, sz * 0.75, sz * 0.4, 0, 0, Math.PI * 2);
          x.fill();
          break;
        case "snowflake":
          // Enam lengan + cabang kecil di ujung — kepingan salju sekecil apa pun.
          x.rotate(p.rot + p.age * 0.8);
          x.strokeStyle = "rgba(255,255,255,0.92)";
          x.lineWidth = 1.3;
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
            x.beginPath(); x.moveTo(0, 0); x.lineTo(ca * sz, sa * sz); x.stroke();
            x.beginPath();
            x.moveTo(ca * sz * 0.62 - sa * sz * 0.2, sa * sz * 0.62 + ca * sz * 0.2);
            x.lineTo(ca * sz * 0.62 + sa * sz * 0.2, sa * sz * 0.62 - ca * sz * 0.2);
            x.stroke();
          }
          break;
        case "sweat":
          x.fillStyle = "#7CC7FF";
          x.beginPath();
          x.moveTo(0, -sz);
          x.quadraticCurveTo(sz * 0.8, sz * 0.2, 0, sz * 0.6);
          x.quadraticCurveTo(-sz * 0.8, sz * 0.2, 0, -sz);
          x.fill();
          break;
        case "z":
          x.fillStyle = "rgb(209,219,235)";
          x.font = `700 ${sz * 1.9}px ${FONT}`;
          x.textAlign = "center";
          x.textBaseline = "middle";
          x.fillText("z", 0, 0);
          break;
      }
      x.restore();
    }
  }
}

/** Ray → rounded-rect boundary intersection, for the mailbox morph. */
function rrPoint(ca: number, sa: number, W: number, H: number, cr: number): { x: number; y: number } {
  const eps = 1e-6;
  const kx = ca >= 0 ? 1 : -1;
  const ky = sa >= 0 ? 1 : -1;
  const cx = kx * (W - cr);
  const cy = ky * (H - cr);

  const dot = ca * cx + sa * cy;
  const disc = dot * dot - (cx * cx + cy * cy - cr * cr);
  if (disc >= 0) {
    const t = dot + Math.sqrt(disc);
    if (t > eps) {
      const px = ca * t;
      const py = sa * t;
      if (Math.abs(px) >= W - cr - eps && Math.abs(py) >= H - cr - eps) return { x: px, y: py };
    }
  }
  if (Math.abs(sa) > eps) {
    const t = (ky * H) / sa;
    if (t > eps) {
      const px = ca * t;
      if (Math.abs(px) <= W - cr + eps) return { x: px, y: ky * H };
    }
  }
  if (Math.abs(ca) > eps) {
    const t = (kx * W) / ca;
    if (t > eps) {
      const py = sa * t;
      if (Math.abs(py) <= H - cr + eps) return { x: kx * W, y: py };
    }
  }
  return { x: kx * W, y: ky * H };
}
