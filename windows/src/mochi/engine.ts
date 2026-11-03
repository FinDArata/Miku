// Mochi — direct port of NotchBuddy/Sources/App/BotEngine.swift to Canvas 2D.
// Same constants, same tweens, same easings, same particles. The only intentional
// difference is the `happy`/`wink` eye arc, which follows the prototype
// (design/prototype/notch-buddy.html, the visual source of truth) — the Swift
// arc angles produce a different shape.

import { Ease, lerp, type EaseFn } from "../core/anim";
import { Sound } from "../core/sound";
import type { BotEmoteName, BotStateName } from "../core/layout";
import { drawOutfitBehind, drawOutfitFront, makeHead } from "./outfits";
import type { Outfit } from "./wardrobe";

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
  type: "heart" | "star" | "spark" | "sweat" | "z";
  x: number; y: number; vx: number; vy: number;
  age: number; life: number; rot: number; size: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────
// (Mochi's squircle constants retired with the Kanon chibi; see K_* below.)

const MINI_INK = "rgb(16,19,26)"; // #10131A

// ── Kanon (花音) — chibi ala Mai Kawasumi (design/prototype/kanon.html v4.3) ──
const K_HAIR: RGB = [0.227, 0.275, 0.408];   // #3A4668
const K_HAIR_D: RGB = [0.165, 0.2, 0.314];   // #2A3350
const K_HAIR_HI = "rgba(92,108,150,0.55)";
const K_BOW: RGB = [0.604, 0.635, 0.878];    // #9AA2E0
const K_BOW_D: RGB = [0.482, 0.514, 0.784];  // #7B83C8
const K_SKIN: RGB = [1, 0.914, 0.863];       // #FFE9DC
const K_EYE_G1: RGB = [0.341, 0.851, 0.604]; // #57D99A
const K_EYE_G2: RGB = [0.051, 0.478, 0.322]; // #0D7A52
const K_EYE_INK = "rgb(28,43,38)";           // #1C2B26
const K_DRESS: RGB = [0.576, 0.224, 0.29];   // #93394A
const K_DRESS_D: RGB = [0.478, 0.173, 0.235];// #7A2C3C
const K_CAPE: RGB = [0.957, 0.957, 0.973];   // #F4F4F8
const K_CAPE_B: RGB = [0.886, 0.89, 0.941];
const K_TRIM: RGB = [0.545, 0.576, 0.839];   // #8B93D6
const K_SAKURA: RGB = [0.957, 0.447, 0.714]; // #F472B6
const K_GOLD = "rgb(245,200,110)";
const K_BLADE = "rgb(201,204,216)";
const K_INK = "rgb(32,36,46)";

function mixRGB(a: RGB, b: RGB, k: number): RGB {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Jepit not ♪ — tanda tangan merek Kanon, digambar di kode. */
function kanonNote(x: CanvasRenderingContext2D, px: number, py: number, s: number, col: string, rot: number) {
  x.save(); x.translate(px, py); x.rotate(rot); x.fillStyle = col;
  x.beginPath(); x.ellipse(0, s * 0.32, s * 0.36, s * 0.26, -0.3, 0, Math.PI * 2); x.fill();
  x.fillRect(s * 0.3, -s * 0.95, s * 0.13, s * 1.27);
  x.beginPath(); x.moveTo(s * 0.43, -s * 0.95);
  x.quadraticCurveTo(s * 0.95, -s * 0.82, s * 0.9, -s * 0.3);
  x.quadraticCurveTo(s * 0.66, -s * 0.52, s * 0.43, -s * 0.42);
  x.closePath(); x.fill();
  x.restore();
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

const rgba = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

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
  /** Solid body colour for mini bots / integration pills (null = Mochi gradient). */
  bodyColor: RGB | null = null;
  /**
   * A new Kanon waits (whats-new/whats-new.ts): while Mochi is idle or asleep
   * he wears the up-arrow badge. The island turns his body blue alongside.
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

  // ── Public API ──────────────────────────────────────────────────────────────

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
    Sound.play("slap");
    this.squash();
    this.physVy -= 1.2;
    this.physVx += Math.random() < 0.5 ? 0.7 : -0.7;
    if (this.slapTimes.length >= 3) {
      this.slapTimes = [];
      this.onDizzy?.();
    } else {
      this.eyeOverride = "line";
      this.eyeOverrideUntil = t + 0.8;
      setTimeout(() => Sound.play("annoyed"), 60);
    }
  }

  doRoll(durationMs: number, turns: number) {
    this.roll = 0;
    this.anim("roll", [[Math.PI * 2 * turns, durationMs, Ease.inOut]], () => { this.roll = 0; });
  }

  /** Peek wave — the "kanon". Timings from BotEngine.greet(). */
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
      Sound.play("greet");
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
        setTimeout(() => Sound.play("annoyed"), 60);
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
      this.anim("outfitPresence", [[1, 350, Ease.inOut]], () => this.squash());
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

  /**
   * Applies the dance bounce and sway around the bottom of the body. Call it on
   * a saved context, before draw(), with the same size (BotEngine.applyDance).
   */
  applyDance(x: CanvasRenderingContext2D, W: number, H: number) {
    if (this.dancingLevel <= 0.001) return;
    const R = W * 0.3;
    const px = W / 2 + this.ox * R;
    const py = H / 2 + this.particleOverhang / 2 + this.oy * R + R * 0.06 + R * 0.88;
    const d = danceTransform(now(), this.dancingLevel, R);
    x.translate(px + d.dx, py + d.dy);
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

    // Kanon: jangkar outfit (makeHead) masih geometri kepala Mochi — topi/aksesori
    // sementara TIDAK digambar sampai diadaptasi ke kepala chibi (fase lanjut).
    // Tanpa ini, topi melayang di posisi lama dan terlihat seperti kepala terbelah.
    const dressed = false;
    const head = dressed ? makeHead(R, this.yaw, this.pitch, this.physDx, this.physDy) : null;
    const outfitState = { presence: this.outfitPresence, morph: this.morph };
    if (head) drawOutfitBehind(x, this.outfit, head, outfitState);

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
    this.drawKanonFront(x, R, rx, ry);

    if (head) drawOutfitFront(x, this.outfit, head, outfitState);

    x.restore();
    x.restore();

    if (this.badge && this.badgeS > 0.01 && this.morph < 0.25) {
      this.drawBadge(x, this.badge, R, cx, cy);
    }
    this.drawParticles(x, R, cx, cy);
  }

  private bodyPath(rx: number, ry: number, R: number): Path2D {
    const n = 72;
    const expN = 2.0 / 2.7;
    const tw = R * 1.0;
    const th = R * 0.94;
    const tr = R * 0.42;
    const p = new Path2D();
    const m = this.morph;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const px0 = rx * (ca >= 0 ? Math.pow(ca, expN) : -Math.pow(-ca, expN));
      const py0 = ry * (sa >= 0 ? Math.pow(sa, expN) : -Math.pow(-sa, expN));
      let px = px0;
      let py = py0;
      if (m >= 0.005) {
        const rr = rrPoint(ca, sa, tw, th, tr);
        px = lerp(px0, rr.x, m);
        py = lerp(py0, rr.y, m);
      }
      if (i === 0) p.moveTo(px, py);
      else p.lineTo(px, py);
    }
    p.closePath();
    return p;
  }

  /** How much of the pumpkin's orange shows on the body (it comes and goes with the outfit). */
  /** Chibi Kanon utuh — lapisan belakang (rambut/pita) sampai badan; wajah di drawEyes.
   *  Semua koordinat 0-relatif terhadap pusat karakter (satu sistem, tanpa translate). */
  private drawBody(x: CanvasRenderingContext2D, _body: Path2D, R: number, _rx: number, _ry: number) {
    const u = R / 158;
    const t = now();
    const state = this.state;
    const tint = Math.min(1, this.tint);
    // Semua koordinat di bawah: ruang proto 0..300, pusat karakter di (150, ~150).
    x.save();
    x.scale(u, u);
    x.translate(-150, -150);

    if (this.isMini) {
      // Mini bot: kepala saja, rambut mewarnai pill
      const hair = this.bodyColor ? mixRGB(K_HAIR, this.bodyColor, 0.62) : K_HAIR;
      x.fillStyle = rgba(hair);
      x.beginPath(); x.ellipse(150, 64, 88, 80, 0, 0, Math.PI * 2); x.fill();
      this.kanonHeadMass(x, hair);
      x.restore();
      return;
    }

    // ── lapisan belakang: tirai rambut panjang + ekor kuda + pita belakang ──
    const sway = this.isDancing ? Math.sin(t * 6) * 6
      : state === "dizzy" ? Math.sin(t * 9) * 5 : Math.sin(t * 1.6) * 1.8;
    const hg = x.createLinearGradient(0, 10, 0, 260);
    hg.addColorStop(0, rgba(K_HAIR));
    hg.addColorStop(1, rgba(K_HAIR_D));
    x.fillStyle = hg;
    x.beginPath(); x.ellipse(150, 64, 88, 80, 0, 0, Math.PI * 2); x.fill();
    for (const s of [-1, 1]) {
      x.beginPath();
      x.moveTo(150 + s * 80 + sway, 90);
      x.quadraticCurveTo(150 + s * 86 + sway, 190, 150 + s * 66 + sway, 246);
      x.quadraticCurveTo(150 + s * 40 + sway, 252, 150 + s * 30 + sway, 236);
      x.quadraticCurveTo(150 + s * 52 + sway, 180, 150 + s * 46 + sway, 96);
      x.closePath(); x.fill();
    }
    x.save(); x.translate(150 + 56 + sway * 0.6, 108); x.rotate(0.12 + sway * 0.02);
    x.fillStyle = rgba(K_HAIR_D);
    x.beginPath(); x.moveTo(-16, 0);
    x.quadraticCurveTo(30, 60, 10, 150);
    x.quadraticCurveTo(-6, 158, -18, 148);
    x.quadraticCurveTo(2, 70, -34, 10);
    x.closePath(); x.fill();
    x.restore();
    // pita belakang: ekor menggantung + loop mengintip dua sisi kepala
    x.fillStyle = rgba(K_BOW_D);
    for (const s of [-1, 1]) {
      x.beginPath();
      x.moveTo(150 + s * 66, 100);
      x.quadraticCurveTo(150 + s * 82, 132, 150 + s * 70, 170);
      x.quadraticCurveTo(150 + s * 62, 165, 150 + s * 57, 150);
      x.quadraticCurveTo(150 + s * 63, 122, 150 + s * 56, 104);
      x.closePath(); x.fill();
    }
    x.fillStyle = rgba(K_BOW);
    for (const s of [-1, 1]) {
      x.save(); x.translate(150 + s * 86, 92); x.rotate(s * 0.55);
      x.beginPath(); x.moveTo(0, 0);
      x.quadraticCurveTo(s * 26, -20, s * 32, 0);
      x.quadraticCurveTo(s * 26, 16, 0, 8);
      x.closePath(); x.fill();
      x.restore();
    }

    // ── gaun marun ──
    const dg = x.createLinearGradient(0, 120, 0, 258);
    dg.addColorStop(0, rgba(K_DRESS));
    dg.addColorStop(1, rgba(K_DRESS_D));
    x.fillStyle = dg;
    x.beginPath(); x.moveTo(150 - 46, 124);
    x.quadraticCurveTo(150 - 62, 200, 150 - 54, 248);
    x.quadraticCurveTo(150, 260, 150 + 54, 248);
    x.quadraticCurveTo(150 + 62, 200, 150 + 46, 124);
    x.closePath(); x.fill();
    x.strokeStyle = "rgba(255,255,255,0.85)"; x.lineWidth = 3;
    x.beginPath(); x.moveTo(150 - 52, 244); x.quadraticCurveTo(150, 256, 150 + 52, 244); x.stroke();

    // ── lengan ──
    x.fillStyle = rgba(K_DRESS);
    if (state === "working") {
      x.beginPath(); x.ellipse(150 - 30, 172, 16, 30, 0.4, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(150 + 30, 172, 16, 30, -0.4, 0, Math.PI * 2); x.fill();
      x.fillStyle = "#fff";
      x.beginPath(); x.ellipse(150 - 14, 198, 9, 8, 0, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(150 + 14, 198, 9, 8, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = rgba(K_SKIN);
      x.beginPath(); x.ellipse(150, 204, 12, 6, 0, 0, Math.PI * 2); x.fill();
    } else {
      x.beginPath(); x.ellipse(150 - 34, 168, 17, 34, 0.35, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(150 + 50, 172, 15, 30, -0.5, 0, Math.PI * 2); x.fill();
      x.fillStyle = "#fff";
      x.beginPath(); x.ellipse(150 + 62, 199, 9, 8, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = rgba(K_SKIN);
      x.beginPath(); x.ellipse(150 + 74, 206, 7.5, 6.5, 0, 0, Math.PI * 2); x.fill();
    }

    // ── cape putih — warna state melebur di sini ──
    const capeTop = mixRGB(K_CAPE, this.col, tint * 0.5);
    const capeBot = mixRGB(K_CAPE_B, this.col, tint * 0.32);
    const cg = x.createLinearGradient(0, 118, 0, 176);
    cg.addColorStop(0, rgba(capeTop));
    cg.addColorStop(1, rgba(capeBot));
    x.fillStyle = cg;
    x.beginPath(); x.moveTo(150 - 58, 120);
    x.quadraticCurveTo(150 - 66, 168, 150 - 44, 176);
    x.lineTo(150 + 44, 176);
    x.quadraticCurveTo(150 + 66, 168, 150 + 58, 120);
    x.quadraticCurveTo(150, 136, 150 - 58, 120);
    x.closePath(); x.fill();
    x.strokeStyle = rgba(K_TRIM, 0.9); x.lineWidth = 3;
    x.beginPath(); x.moveTo(150 - 60, 128); x.quadraticCurveTo(150 - 64, 164, 150 - 44, 174);
    x.lineTo(150 + 44, 174); x.quadraticCurveTo(150 + 64, 164, 150 + 60, 128); x.stroke();

    // ── pita leher ──
    x.fillStyle = rgba(K_DRESS);
    roundRectPath(x, 150 - 15, 136, 30, 9, 3); x.fill();
    x.fillStyle = "#6b83d9";
    x.beginPath(); x.moveTo(150, 150); x.quadraticCurveTo(150 - 24, 139, 150 - 31, 150);
    x.quadraticCurveTo(150 - 24, 163, 150, 159); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(150, 150); x.quadraticCurveTo(150 + 24, 139, 150 + 31, 150);
    x.quadraticCurveTo(150 + 24, 163, 150, 159); x.closePath(); x.fill();
    x.beginPath(); x.ellipse(150, 152, 6.5, 5, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#5a72c4";
    x.beginPath(); x.moveTo(150 - 3, 157); x.quadraticCurveTo(150 - 9, 172, 150 - 15, 181);
    x.lineTo(150 - 6, 179); x.quadraticCurveTo(150 - 1, 166, 150 + 3, 157); x.closePath(); x.fill();

    // ── kepala: wajah + poni + side locks ──
    this.kanonHeadMass(x, K_HAIR);
    x.restore();
  }

  /** Wajah + poni + side locks (dipakai chibi penuh dan mini). */
  private kanonHeadMass(x: CanvasRenderingContext2D, hair: RGB) {
    x.fillStyle = rgba(K_SKIN);
    x.beginPath(); x.ellipse(150, 76, 64, 60, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = rgba(hair);
    for (let i = -2; i <= 2; i++) {
      x.save(); x.translate(150 + i * 28, 38 + Math.abs(i) * 3); x.rotate(i * 0.05);
      x.beginPath(); x.ellipse(0, 0, 24, 27, 0, 0, Math.PI * 2); x.fill();
      x.restore();
    }
    x.fillStyle = K_HAIR_HI; x.globalAlpha = 0.55;
    x.beginPath(); x.ellipse(116, 26, 6, 15, 0.25, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(182, 24, 5.5, 14, -0.2, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;
    x.fillStyle = rgba(K_HAIR_D);
    x.beginPath(); x.ellipse(84, 96, 13, 52, 0.08, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(216, 96, 13, 52, -0.08, 0, Math.PI * 2); x.fill();
  }

  /** Wajah Kanon: alis, mata (half-lidded stoic + emote), mulut, kacamata. */
  private drawEyes(x: CanvasRenderingContext2D, _body: Path2D, R: number, _rx: number, _ry: number) {
    let shape: EyeShape = this.eyeOverride ?? this.cfg.eye;
    if (this.isDancing && this.dancingLevel > 0.15 && !this.isMini && (this.state === "idle" || this.state === "finished")) {
      shape = "happy";
    }
    const u = R / 158;
    const state = this.state;
    const ink = this.isMini ? MINI_INK : K_EYE_INK;
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
      // iris gradien zamrud
      const iris = x.createLinearGradient(0, ey - EH, 0, ey + EH);
      iris.addColorStop(0, rgba(K_EYE_G1));
      iris.addColorStop(1, rgba(K_EYE_G2));
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
      x.fillStyle = rgba(K_SKIN);
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

  /** Lapisan paling depan: ahoge, jepit not, katana/laptop. */
  private drawKanonFront(x: CanvasRenderingContext2D, R: number, _rx: number, _ry: number) {
    if (this.isMini) return;
    const u = R / 158;
    const t = now();
    const state = this.state;
    x.save();
    x.scale(u, u);
    x.translate(-150, -150);

    // ahoge — antena sakura, tenang kecuali sedang joget/cegang
    const sway = state === "dizzy" ? Math.sin(t * 9) * 8
      : this.isDancing ? Math.sin(t * 6) * 11 : Math.sin(t * 1.8) * 2;
    x.strokeStyle = rgba(K_SAKURA); x.lineWidth = 3; x.lineCap = "round";
    x.beginPath(); x.moveTo(150, 12);
    x.quadraticCurveTo(153, -2, 160 + sway, -6);
    x.quadraticCurveTo(169 + sway * 1.5, -6, 163 + sway * 1.5, 5);
    x.stroke();
    kanonNote(x, 54, 90, 16, rgba(K_SAKURA), 0.2);

    if (state === "working") {
      // laptop di pelukan + petir error kecil
      x.fillStyle = K_INK;
      roundRectPath(x, 110, 186, 80, 44, 8); x.fill();
      x.fillStyle = "#22d3ee"; x.globalAlpha = 0.8;
      for (let i = 0; i < 3; i++) x.fillRect(118, 198 + i * 9, 44, 4);
      x.globalAlpha = 1;
      if ((t % 1.2) < 0.5) {
        x.fillStyle = "#fde047";
        x.beginPath(); x.moveTo(210, 146); x.lineTo(198, 194); x.lineTo(210, 194);
        x.lineTo(198, 240); x.lineTo(226, 184); x.lineTo(211, 184); x.lineTo(223, 146);
        x.closePath(); x.fill();
      }
    } else if (this.outfit === "none" && R >= 30) {
      // katana di sisi kanan, digenggam tangan yang sudah digambar di badan
      x.save(); x.translate(224, 158); x.rotate(0.09);
      x.fillStyle = K_BLADE;
      x.beginPath(); x.moveTo(-4, 190); x.lineTo(4, 190); x.lineTo(3, 42); x.lineTo(0, 32);
      x.lineTo(-3, 42); x.closePath(); x.fill();
      x.fillStyle = K_GOLD;
      roundRectPath(x, -9, 190, 18, 6, 2); x.fill();
      x.fillStyle = K_INK;
      roundRectPath(x, -4, 196, 8, 28, 3); x.fill();
      x.restore();
      x.fillStyle = "#fff";
      x.beginPath(); x.ellipse(212, 199, 9, 8, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = rgba(K_SKIN);
      x.beginPath(); x.ellipse(224, 206, 7.5, 6.5, 0, 0, Math.PI * 2); x.fill();
    }

    x.restore();
  }

  /** Kanon: moe-sode — tangan tak terlihat; gestur sapa jadi anggukan kepala. */
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
      // The "!" badge's ring and disc, with a white up-arrow: a new Kanon is out.
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
