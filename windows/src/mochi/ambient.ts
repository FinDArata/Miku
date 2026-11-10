// Ambient weather for the two skins that carry it: snow drifting on Snow Miku,
// petals on Sakura Miku — the classic stays clean. One canvas per surface,
// sized to its box and stepped by the surface's own loop (the island's frame
// loop here); `active` says whether the fall still has life in it, so an idle
// loop can stop. The system asking for less motion turns it off entirely.
// The hub's stage has its own weather already (hub/hero.ts stageWeather); this
// is the island's.

import { reducedMotion } from "../core/anim";
import type { MikuVariantId } from "./variants";
import type { SkyTint } from "./sky";

export type AmbientKind = "none" | "snow" | "petal";

/** Which weather a variant carries: Snow falls, Sakura drifts petals. */
export function ambientFor(variant: MikuVariantId): AmbientKind {
  return variant === "snow" ? "snow" : variant === "sakura" ? "petal" : "none";
}

interface Flake {
  x: number;
  y: number;
  vy: number;
  sway: number;
  size: number;
  rot: number;
  rotV: number;
  phase: number;
  alpha: number;
}

export class Ambient {
  private kind: AmbientKind = "none";
  private flakes: Flake[] = [];
  private t = 0;
  private canvas: HTMLCanvasElement;
  /** The hour's light (sky.ts): the fall wears it. */
  private sky: SkyTint = { rgb: [1, 1, 1], strength: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /** Swaps the hour's light; asked every frame, cheap when unchanged. */
  setSky(sky: SkyTint) {
    this.sky = sky;
  }

  /** Swaps the weather; asked every frame by the surface, so a variant picked
   * in the wardrobe changes it at once, without a rebuild. */
  set(kind: AmbientKind) {
    if (reducedMotion()) kind = "none";
    if (kind === this.kind) return;
    this.kind = kind;
    this.flakes = [];
  }

  /** True while the fall draws — the surface's loop stays up on this. */
  get active(): boolean {
    return this.kind !== "none";
  }

  /** Advances and draws one frame across the whole canvas (CSS pixels; the
   * bitmap is sized here). True while anything drew. */
  step(dt: number): boolean {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return false;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!this.active || w < 2 || h < 2) {
      if (this.canvas.width !== 0) ctx.clearRect(0, 0, w, h);
      return false;
    }
    if (this.canvas.width !== Math.round(w * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.t += dt;

    // A density that reads the same on a compact island and a full panel.
    const target = Math.round(Math.min(46, Math.max(10, (w * h) / 9000)));
    while (this.flakes.length < target) this.flakes.push(this.newFlake(w, h, true));
    if (this.flakes.length > target) this.flakes.length = target;

    const petal = this.kind === "petal";
    // The hour's light on the fall: dawn warms the snow peach, dusk violets
    // the petals — and a wash faint enough to read as evening, not as a filter.
    const [tr, tg, tb] = this.sky.rgb;
    const flakeFill = petal
      ? `rgb(${Math.round(247 * tr)},${Math.round(182 * tg)},${Math.round(206 * tb)})`
      : `rgb(${Math.round(234 * tr)},${Math.round(244 * tg)},${Math.round(255 * tb)})`;
    if (this.sky.strength > 0) {
      ctx.fillStyle = `rgba(${Math.round(tr * 255)},${Math.round(tg * 255)},${Math.round(tb * 255)},${(this.sky.strength * 0.05).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
    for (const f of this.flakes) {
      f.y += f.vy * dt;
      f.rot += f.rotV * dt;
      const x = f.x + Math.sin(this.t * 0.9 + f.phase) * f.sway;
      if (f.y > h + 8) Object.assign(f, this.newFlake(w, h, false));

      ctx.save();
      ctx.globalAlpha = f.alpha;
      ctx.translate(x, f.y);
      ctx.rotate(f.rot);
      ctx.fillStyle = flakeFill;
      ctx.beginPath();
      if (petal) ctx.ellipse(0, 0, f.size * 1.9, f.size * 0.95, 0, 0, Math.PI * 2);
      else ctx.arc(0, 0, f.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    return true;
  }

  /** A new flake; `scatter` fills the canvas at once (the first frames), the
   * rest start just above the top so they walk in. */
  private newFlake(w: number, h: number, scatter: boolean): Flake {
    return {
      x: Math.random() * w,
      y: scatter ? Math.random() * h : -8,
      vy: (this.kind === "petal" ? 16 : 13) + Math.random() * 14,
      sway: 5 + Math.random() * 9,
      size: this.kind === "petal" ? 1.6 + Math.random() * 1.7 : 0.9 + Math.random() * 1.5,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 2.2,
      phase: Math.random() * Math.PI * 2,
      alpha: (this.kind === "petal" ? 0.5 : 0.38) + Math.random() * 0.3,
    };
  }
}
