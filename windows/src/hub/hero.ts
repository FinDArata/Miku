// The coloured band on top of each page of the Miku window: a deep black
// with the page's colour breathing in a corner, and particles that drift all
// the time and move away from the pointer. Also the glowing cards and the
// Mochis of empty pages. Port of FlowHubMochis.swift.
//
// One animation loop draws every live canvas; it stops when none is left or
// the window is hidden, so a hidden window costs nothing, and skips the ones
// scrolled out of sight.

import { BotEngine, hexToRGB } from "../mochi/engine";
import { SeasonCache, VariantCache, parseOutfit, parseVariant } from "../mochi/wardrobe";
import { onScreen, shouldAnimate } from "./frames";
import type { BotStateName } from "../core/layout";
import { State } from "../core/state";
import { currentSkin, themeFor } from "../theme/skins";

interface Animated {
  el: HTMLCanvasElement;
  draw(dt: number, t: number): void;
  /** Pages are built before they are put in the window: dropped only once gone. */
  shown?: boolean;
  born?: number;
}

const live = new Set<Animated>();
let frame: number | null = null;
/** The stand-in timer while the webview gives no animation frames (see `ask`). */
let fallback: number | null = null;
/** No animation frame came after the last ask: the timer drives the loop. */
let starved = false;
let last = performance.now();
const start = performance.now();
/** The Miku window is on screen, as Rust last said (`setWindowShown`). */
let windowShown = true;

function running(): boolean {
  // WebView2 can leave a window created hidden reporting "hidden" once shown:
  // focused, it is in front of the user whatever the page thinks.
  const visibility = document.hasFocus?.() ? "visible" : document.visibilityState;
  return shouldAnimate(live.size, visibility, windowShown);
}

function loop(now: number) {
  frame = null;
  if (fallback !== null) {
    window.clearTimeout(fallback);
    fallback = null;
  }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = (now - start) / 1000;
  stepVoice(dt, now);
  for (const a of live) {
    if (!a.el.isConnected) {
      // Built but not shown yet: wait for it (a few seconds at most).
      if (a.shown || now - (a.born ??= now) > 5000) live.delete(a);
      continue;
    }
    a.shown = true;
    if (onScreen(a.el.getBoundingClientRect(), window.innerWidth, window.innerHeight)) a.draw(dt, t);
  }
  if (running()) ask();
}

/**
 * The next frame. WebView2 gives a window created hidden no animation frames
 * until something wakes its compositor, so a timer stands in when
 * none comes: the bands stay alive at 30 frames a second instead of frozen,
 * and the loop goes back to real frames the moment one arrives.
 */
function ask() {
  frame = requestAnimationFrame((now) => {
    starved = false;
    loop(now);
  });
  fallback = window.setTimeout(() => {
    fallback = null;
    if (frame === null) return;
    cancelAnimationFrame(frame);
    starved = true;
    loop(performance.now());
  }, starved ? 33 : 250);
}

function wake() {
  if (frame === null && fallback === null && running()) {
    last = performance.now();
    ask();
  }
}

document.addEventListener("visibilitychange", wake);
window.addEventListener("focus", wake);

/** The window was shown or hidden (the `hub-visible` event): hidden, the loop
 *  stops at once; shown, it starts again. */
export function setWindowShown(shown: boolean) {
  windowShown = shown;
  if (!shown) {
    if (frame !== null) cancelAnimationFrame(frame);
    if (fallback !== null) window.clearTimeout(fallback);
    frame = null;
    fallback = null;
  }
  wake();
}

// ── The voice ─────────────────────────────────────────────────────────────────

/** How loud the dictation is, 0…1, as the bands last said (`flow-bands`). */
let voiceGoal = 0;
let voiceAt = 0;
/** The level the bands draw with, eased towards the voice. */
let voice = 0;

/** While you dictate, the bands' light and particles follow your voice. */
export function setVoiceLevel(level: number) {
  voiceGoal = Math.max(0, Math.min(1, level));
  voiceAt = performance.now();
  wake();
}

/** One step of the eased level; the voice fades once the bands stop coming. */
function stepVoice(dt: number, now: number) {
  const goal = now - voiceAt > 250 ? 0 : voiceGoal;
  voice += (goal - voice) * Math.min(1, dt * (goal > voice ? 14 : 4));
  if (voice < 0.001) voice = 0;
}

function add(a: Animated) {
  live.add(a);
  wake();
}

function fit(canvas: HTMLCanvasElement): { w: number; h: number; ctx: CanvasRenderingContext2D | null } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, ctx };
}

/** "r,g,b" of each colour, read once: the particles ask every frame. */
const channels = new Map<string, string>();

function rgba(hex: string, alpha: number): string {
  let rgb = channels.get(hex);
  if (rgb === undefined) {
    const [r, g, b] = hexToRGB(hex);
    rgb = `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;
    channels.set(hex, rgb);
  }
  return `rgba(${rgb},${Math.max(0, Math.min(1, alpha))})`;
}

// ── The backdrop ──────────────────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  depth: number;
  phase: number;
  /** 0 = the page's colour, 1 = white, 2 = Miku's teal. */
  kind: 0 | 1 | 2;
}

/** Miku's teal, as the skin in force has it: the thread every band shares. */
function mikuColor(): string {
  return themeFor(currentSkin()).accent;
}

/** The deep black, the colour and the particles, on `canvas`; `pointerFrom` is
 *  the element whose pointer pushes the particles. */
export function backdrop(canvas: HTMLCanvasElement, color: string, pointerFrom: HTMLElement, radius = 18) {
  let particles: Particle[] = [];
  let pointer: { x: number; y: number } | null = null;
  let strength = 0;
  pointerFrom.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  pointerFrom.addEventListener("pointerleave", () => (pointer = null));

  const seed = (w: number, h: number) => {
    const count = Math.round(Math.min(90, Math.max(24, (w * h) / 2600)));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 6,
      vy: -2 - Math.random() * 6,
      r: 0.5 + Math.random() * 1.4,
      depth: 0.35 + Math.random() * 0.65,
      phase: Math.random() * Math.PI * 2,
      // Mostly the page's own colour, with Miku's teal mixed in so every band
      // still feels like the same app.
      kind: Math.random() < 0.3 ? 1 : Math.random() < 0.55 ? 2 : 0,
    }));
  };

  add({
    el: canvas,
    draw(dt, t) {
      const { w, h, ctx } = fit(canvas);
      if (!ctx || w === 0) return;
      if (particles.length === 0) seed(w, h);
      strength += ((pointer ? 1 : 0) - strength) * Math.min(1, dt * 4);
      // Asked every frame: a skin picked in the wardrobe reaches the band
      // without the page being rebuilt.
      const miku = mikuColor();
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, radius);
      ctx.clip();
      ctx.fillStyle = "#020405";
      ctx.fillRect(0, 0, w, h);
      const lin = ctx.createLinearGradient(w, 0, w * 0.35, h);
      lin.addColorStop(0, rgba(color, 0.12));
      lin.addColorStop(0.5, rgba(miku, 0.05));
      lin.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = lin;
      ctx.fillRect(0, 0, w, h);
      // The voice brightens the glow and lifts the particles.
      const breath = 0.85 + 0.15 * Math.sin(t * 0.9) + voice * 0.55;
      const rad = ctx.createRadialGradient(w * 0.92, -h * 0.15, 0, w * 0.92, -h * 0.15, Math.max(w, h) * 0.55 * breath);
      rad.addColorStop(0, rgba(color, 0.28 * breath));
      rad.addColorStop(0.35, rgba(miku, 0.11 * breath));
      rad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rad;
      ctx.fillRect(0, 0, w, h);

      for (const p of particles) {
        // Drift, always; the pointer pushes them away.
        const lift = 1 + voice * 5;
        p.x += p.vx * dt * p.depth;
        p.y += p.vy * dt * p.depth * lift;
        let alpha = (0.22 + 0.5 * (0.5 + 0.5 * Math.sin(t * (1.2 + p.depth) + p.phase))) * p.depth + voice * 0.35;
        let r = p.r * (1 + voice * 0.6);
        if (pointer && strength > 0.01) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < 140 && d > 0.1) {
            const push = (1 - d / 140) * 90 * strength * dt;
            p.x += (dx / d) * push;
            p.y += (dy / d) * push;
          }
          if (d < 200) {
            const near = (1 - d / 200) * strength;
            alpha += near * 0.6;
            r *= 1 + near * 0.8;
          }
        }
        if (p.y < -4) p.y = h + 4;
        if (p.y > h + 4) p.y = -4;
        if (p.x < -4) p.x = w + 4;
        if (p.x > w + 4) p.x = -4;
        const tint = p.kind === 1 ? "#FFFFFF" : p.kind === 2 ? miku : color;
        if (r > 1.1) {
          ctx.fillStyle = rgba(tint, Math.min(1, alpha) * 0.12);
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = rgba(tint, Math.min(1, alpha));
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Two slow waves along the floor of the band: they breathe with the
      // glow, and stand up while you dictate.
      const waveAmp = h * 0.035 * (0.6 + voice * 2.2);
      for (let k = 0; k < 2; k++) {
        const amp = waveAmp * (k === 0 ? 1 : 0.55);
        const y0 = h - 6 - k * 4;
        ctx.beginPath();
        for (let x = -6; x <= w + 6; x += 5) {
          const y = y0 + Math.sin(x / (52 + k * 26) + t * (0.65 + k * 0.3)) * amp;
          if (x < 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = rgba(k === 0 ? color : miku, 0.14 + voice * 0.3);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    },
  });
}

// ── The Mochi ─────────────────────────────────────────────────────────────────

/** "auto" → the season's Miku, remembered for the day. */
const variants = new VariantCache();
/** "auto" → the season's outfit, remembered for the day. */
const seasons = new SeasonCache();

/** Which Miku is drawn: the one hovered in the wardrobe, else the saved one. */
export function shownVariant() {
  return State.variantPreview ?? variants.get(parseVariant(State.settings.mikuVariant));
}

/** What she wears: the one hovered in the wardrobe, else the saved one. */
export function shownOutfit() {
  return State.wardrobePreview ?? seasons.get(parseOutfit(State.settings.mochiOutfit));
}

/**
 * One Miku alone (the sidebar's logo, an empty page, the wardrobe's preview),
 * in the user's variant and outfit.
 *
 * `headroom` is how much of the canvas the character leaves free above itself,
 * 0…1 of its height. A party hat and a witch hat rise well past the head, so
 * the preview asks for room; without it their tip is cut off by the canvas.
 */
export function liveMochi(
  canvas: HTMLCanvasElement,
  color = "#F5F6F8",
  state: BotStateName = "idle",
  headroom = 0,
) {
  const engine = new BotEngine();
  engine.setVariant(shownVariant());
  engine.setOutfit(shownOutfit(), false);
  engine.bodyColor = hexToRGB(color);
  engine.setState(state, true);
  canvas.addEventListener("click", () => engine.slap());
  let mouse: { x: number; y: number } | null = null;
  window.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    mouse = { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
  });
  add({
    el: canvas,
    draw(dt) {
      const { w, h, ctx } = fit(canvas);
      if (!ctx || w === 0) return;
      if (mouse) {
        engine.lookX = Math.max(-1, Math.min(1, mouse.x / 300));
        engine.lookY = Math.max(-1, Math.min(1, mouse.y / 300));
      }
      // Asked every frame, as the island does: a variant or outfit picked (or
      // only hovered) in the wardrobe shows here at once, not only after the
      // window is rebuilt.
      engine.setVariant(shownVariant());
      engine.setOutfit(shownOutfit());
      engine.update(dt);
      ctx.clearRect(0, 0, w, h);
      // The character is drawn into the lower part of the canvas, with the
      // spare height above for a tall hat.
      const body = headroom > 0 ? h * (1 - headroom) : h;
      engine.draw(ctx, w, body);
    },
  });
  return engine;
}

// ── Page colours ──────────────────────────────────────────────────────────────

/** Each page's colour, worn by the band at the top and by its glow.
 *  The pages that belong to Miku herself (Home, General, Wardrobe) wear the
 *  skin's accent: they change colour with her. */
export const THEMES: Record<string, { color: string }> = {
  home: { get color() { return mikuColor(); } },
  dictation: { color: "#FB923C" },
  notes: { color: "#3B9EFF" },
  insights: { color: "#34D399" },
  dictionary: { color: "#A78BFA" },
  snippets: { color: "#F7B32B" },
  styles: { color: "#F472B6" },
  wardrobe: { get color() { return mikuColor(); } },
  flowsettings: { color: "#7E9A98" },
  general: { get color() { return mikuColor(); } },
  pills: { color: "#F5A524" },
  agents: { color: "#3B9EFF" },
  chat: { color: "#E07950" },
  integrations: { color: "#7C5CFF" },
  phone: { color: "#3DDC84" },
  voice: { color: "#F97316" },
  shortcuts: { color: "#6366F1" },
  mailOverview: { color: "#2F8CFF" },
  mailRules: { color: "#34D399" },
  mailBanned: { color: "#FF453A" },
  mailVIP: { color: "#F5A524" },
};

/** The band itself: title, line and actions. */
export function hero(page: string, title: string, subtitle: string | null, actions: HTMLElement[] = [], compact = false): HTMLElement {
  const theme = THEMES[page] ?? THEMES.general;
  const el = document.createElement("div");
  el.className = compact ? "hub-hero compact" : "hub-hero";
  el.style.setProperty("--hero-line", rgba(theme.color, 0.16));
  el.style.setProperty("--hero-glow", rgba(theme.color, 0.3));
  el.style.setProperty("--hero-tint", rgba(theme.color, 0.1));
  const back = document.createElement("canvas");
  back.className = "backdrop";
  const copy = document.createElement("div");
  copy.className = "copy";
  const h1 = document.createElement("h1");
  h1.textContent = title;
  copy.append(h1);
  if (subtitle) {
    const p = document.createElement("p");
    p.textContent = subtitle;
    copy.append(p);
  }
  if (actions.length) {
    const row = document.createElement("div");
    row.className = "actions";
    row.append(...actions);
    copy.append(row);
  }
  el.append(back, copy);
  backdrop(back, theme.color, el);
  return el;
}

/** A card in a colour: the band's black and particles behind `content`. */
export function glowCard(color: string, ...content: (HTMLElement | string)[]): HTMLElement {
  const el = document.createElement("div");
  el.className = "hub-glow";
  el.style.setProperty("--glow-line", rgba(color, 0.18));
  el.style.setProperty("--hero-glow", rgba(color, 0.3));
  el.style.setProperty("--hero-tint", rgba(color, 0.1));
  const canvas = document.createElement("canvas");
  const inner = document.createElement("div");
  inner.className = "inner";
  inner.append(...content);
  el.append(canvas, inner);
  backdrop(canvas, color, el, 14);
  return el;
}

/** An empty page: a Mochi asleep, and a line. */
export function emptyState(text: string, state: BotStateName = "sleeping", color = "#F5F6F8"): HTMLElement {
  const el = document.createElement("div");
  el.className = "hub-empty";
  const canvas = document.createElement("canvas");
  const p = document.createElement("div");
  p.textContent = text;
  el.append(canvas, p);
  liveMochi(canvas, color, state);
  return el;
}
