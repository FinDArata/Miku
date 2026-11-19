// Miku catching dropped files, on the deck's Shelf page (dev/drop-mockup.html
// and dev/shelf-copy-mockup.html, moved into the deck): while files hover the
// island she reaches up for them; dropped, they fall one by one into her hands
// (a squash, a sparkle, a "+1", a tick), then each flies to its own tile on the
// shelf once its copy into the inbox is done. A copy still running holds her
// up: she keeps hold of it, a little Miku runs the copy bar over the page, its
// tile waits as a ghost with its own bar, and 100 % gets a moment of its own.
//
// The deck draws her (`drawMiku`, in her design units, on its own canvas) and
// an overlay over the page (`drawOverlay`, CSS pixels) with the files in the
// air and the copy bar; the island says when files hover, leave and drop, and
// how each copy goes.

import { colorOf, tagOf } from "../core/shelf";
import { Sound } from "../core/sound";
import { CHIBI_H, drawChibi } from "../mochi/chibi";
import type { MikuVariantId } from "../mochi/variants";

const FALL = 0.42;
const STAGGER = 0.24;
/** At most this many fall one by one; the rest pour in with the last. */
const FALLERS = 7;
/** More than she can hold: she wobbles first. */
const ARMFUL = 5;
const PUT_GAP = 0.1;
const PUT_FLY = 0.45;
/** Files that fly to their own tile; the rest just appear with the last. */
const FLYERS = 8;
/** The "all copied" moment on the bar. */
const DONE_T = 0.9;
/** Still copying this long after she is ready: a heavy one, she sweats. */
const SLOW = 1.5;
const PINK = "#E12885";
const TEAL = "#39C5BB";
const HOLD = [15, -70, -15, 70] as const;
const REACH = [130, 25, -130, -25] as const;
/** Where her hands hold things, in her design units. */
export const HANDS = { x: 260, y: 380 };

type Ctx = CanvasRenderingContext2D;
interface Point { x: number; y: number }
/** Where things are on the overlay, in its CSS pixels. */
export interface CatchGeometry {
  /** Her hands. */
  hands: Point;
  /** Where the files fall from (the top of the page). */
  from: Point;
  /** The centre of a file's tile (or its ghost), when it is on the page. */
  tileAt(name: string): Point | null;
  /** Where the copy bar runs, when the page has made room for it. */
  bar: { x: number; y: number; w: number } | null;
}

/** A file waiting on its copy, for the page's ghost tile. */
export interface Ghost { name: string; progress: number; copied: boolean }

interface Caught {
  name: string;
  /** When its copy finished, in seconds after the drop; null while it runs. */
  copied: number | null;
  failed: boolean;
  /** How far its copy is, 0–1. */
  progress: number;
}

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const eOut = (k: number) => 1 - Math.pow(1 - k, 3);
const eIn = (k: number) => k * k * k;
const eBack = (k: number) => 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2);

/**
 * When each part of the catch happens, in seconds after the drop. A file flies
 * once she is ready and its copy is done; while one still copies, the catch has
 * no end yet (`done` is Infinity).
 */
export function catchTimeline(files: readonly { copied: number | null; failed?: boolean }[]) {
  const count = Math.max(1, files.length);
  const m = Math.min(count, FALLERS);
  const caught = (m - 1) * STAGGER + FALL;
  const heavy = count > ARMFUL;
  const ready = (heavy ? caught + 0.9 : caught) + 0.3;
  const landings = Array.from({ length: m }, (_, i) => i * STAGGER + FALL);
  const flyAt = files.map((f, i) =>
    f.failed ? Infinity : Math.max(ready + Math.min(i, FLYERS - 1) * PUT_GAP, f.copied ?? Infinity));
  const landAt = flyAt.map((at) => at + PUT_FLY);
  const pending = files.some((f) => f.copied == null);
  const allAt = pending ? Infinity : Math.max(0, ...files.map((f) => f.copied ?? 0));
  // The bar shows only when a copy was still running once she was ready.
  const bar = files.some((f) => f.copied == null || f.copied > ready);
  const lastLand = Math.max(0, ...landAt.filter((at) => at < Infinity));
  const done = pending ? Infinity : Math.max(lastLand, bar ? allAt + DONE_T + 0.2 : 0) + 0.5;
  return { m, caught, heavy, ready, landings, flyAt, landAt, pending, allAt, bar, done };
}

class ShelfCatch {
  /** How many files hover the island (0: none). */
  hovering = 0;
  private files: Caught[] = [];
  private at: number | null = null;
  private ticked = 0;
  private chimed = false;
  /** The bar's fill as drawn, easing toward the copies' real progress. */
  private shownTotal = 0;
  private shownAt = 0;

  hover(count: number) {
    this.hovering = Math.max(1, count);
  }

  leave() {
    this.hovering = 0;
  }

  /** Files were let go: the catch starts now, their copies with it. */
  drop(names: string[]) {
    this.hovering = 0;
    this.files = (names.length ? names : ["file"]).map((name) => ({ name, copied: null, failed: false, progress: 0 }));
    this.at = performance.now() / 1000;
    this.ticked = 0;
    this.chimed = false;
    this.shownTotal = 0;
    this.shownAt = 0;
  }

  /** How far the `i`th file's copy is. */
  progress(i: number, fraction: number) {
    const f = this.files[i];
    if (f && f.copied == null) f.progress = clamp(fraction);
  }

  /** The `i`th file is on the shelf, under `name` (a clash adds " (2)"), so it finds its tile. */
  copied(i: number, name: string) {
    const f = this.files[i];
    if (!f || f.copied != null) return;
    f.name = name;
    f.progress = 1;
    f.copied = this.since() ?? 0;
  }

  /** The `i`th file could not be copied: it leaves her arms, and gets no tile. */
  failed(i: number) {
    const f = this.files[i];
    if (!f || f.copied != null) return;
    f.failed = true;
    f.copied = this.since() ?? 0;
  }

  /** Nothing made it: no catch. */
  cancel() {
    this.at = null;
    this.hovering = 0;
  }

  private since(now = performance.now() / 1000): number | null {
    return this.at == null ? null : now - this.at;
  }

  /** Something to draw: files hovering, or a catch still running. */
  get active(): boolean {
    return this.hovering > 0 || this.catching;
  }

  /** A drop is being caught (not merely files hovering). */
  get catching(): boolean {
    const t = this.since();
    return t != null && t < catchTimeline(this.files).done;
  }

  /** A tile whose file is still copying or in the air stays hidden until it lands. */
  waiting(name: string): boolean {
    const t = this.since();
    if (t == null) return false;
    const i = this.files.findIndex((f) => f.name === name && !f.failed);
    return i >= 0 && t < catchTimeline(this.files).landAt[i];
  }

  /** The copy bar is on the page (the deck makes room for it). */
  get barShown(): boolean {
    const t = this.since();
    if (t == null) return false;
    const tl = catchTimeline(this.files);
    return tl.bar && t >= tl.ready && t < tl.allAt + DONE_T + 0.2;
  }

  /** How many copies are done, of how many ("Copying 1/3"). */
  get copyCount(): { done: number; count: number } {
    return { done: this.files.filter((f) => f.copied != null).length, count: this.files.length };
  }

  /** Once she is ready, the files still waiting to fly: ghost tiles on the page. */
  ghosts(): Ghost[] {
    const t = this.since();
    if (t == null) return [];
    const tl = catchTimeline(this.files);
    if (t < tl.ready) return [];
    return this.files
      .filter((f, i) => !f.failed && t < tl.flyAt[i])
      .slice(0, FLYERS)
      .map((f) => ({ name: f.name, progress: f.progress, copied: f.copied != null }));
  }

  /** What the Shelf page lays out for the catch: it renders again when this changes. */
  layoutKey(): string {
    return `${this.barShown ? 1 : 0}|${this.ghosts().map((g) => g.name).join("/")}`;
  }

  /** A tick for every catch, a chime once everything is on the shelf. */
  sounds() {
    const t = this.since();
    if (t == null) return;
    const tl = catchTimeline(this.files);
    const caught = tl.landings.filter((at) => t >= at).length;
    if (caught > this.ticked) {
      this.ticked = caught;
      Sound.play("tick");
    }
    if (!this.chimed && !tl.pending && t >= tl.done - 0.5) {
      this.chimed = true;
      Sound.play("catch");
    }
  }

  /**
   * Draws her catching, in her design units (the caller has fitted the chibi to
   * its canvas). False when there is nothing to catch: the page's pose then.
   */
  drawMiku(x: Ctx, clock: number, variant: MikuVariantId): boolean {
    const o = { noShadow: true } as const;
    if (this.hovering > 0) {
      drawChibi(x, "surprised", clock, variant, { ...o, arms: REACH, look: [10, -12], pitch: -0.45 });
      return true;
    }
    const t = this.since();
    if (t == null) return false;
    const tl = catchTimeline(this.files);
    if (t >= tl.done) return false;

    let landed = 0;
    let squash = 1;
    let lastLand = -1;
    tl.landings.forEach((land, i) => {
      if (t < land) return;
      landed++;
      lastLand = land;
      squash -= Math.sin(clamp((t - land) / 0.22) * Math.PI) * (tl.heavy ? 0.05 + i * 0.012 : 0.06);
    });
    // In her arms: caught, not flown to the shelf yet, and not failed.
    const reach = landed >= tl.m ? this.files.length : landed;
    const held = this.files
      .filter((f, i) => i < reach && !f.failed && t < tl.flyAt[i])
      .slice(0, tl.heavy ? FALLERS : ARMFUL)
      .map((f) => f.name);
    const hop = t < FALL ? Math.sin(clamp((t - (FALL - 0.3)) / 0.3) * Math.PI) * 30 : 0;
    const slow = tl.pending && t > tl.ready + SLOW;

    x.save();
    // Squash and hop about her feet.
    x.translate(260, 480 - hop);
    x.scale(2 - squash, squash);
    x.translate(-260, -480);
    if (t < tl.caught) {
      drawChibi(x, "surprised", clock, variant, {
        ...o,
        arms: landed ? HOLD : REACH,
        eyes: landed && t - lastLand < 0.28 ? "happy" : undefined,
        look: [0, landed ? -6 : -14],
        pitch: landed ? -0.2 : -0.5,
        skipFx: new Set(["lines"]),
      });
      if (landed) pile(x, HANDS.x, HANDS.y + 60, 115, 140, held, 0);
    } else if (t < tl.ready && tl.heavy) {
      const sway = Math.sin(clock * 6) * (2 + landed);
      drawChibi(x, "error", clock, variant, { ...o, arms: HOLD, eyes: "wide", look: [0, -12], pitch: -0.3 });
      pile(x, HANDS.x, HANDS.y + 60, 115, 140, held, sway);
    } else if (tl.pending && held.length) {
      // Holding on while the copies run, a spinner over her head; a slow one
      // and she sweats under it.
      const sway = slow ? Math.sin(clock * 5) * 3 : Math.sin(clock * 2) * 1.2;
      drawChibi(x, slow ? "error" : "idle", clock, variant, {
        ...o, arms: HOLD, eyes: slow ? "wide" : "open", look: [12, -16], pitch: -0.25,
      });
      pile(x, HANDS.x, HANDS.y + 60, 115, 140, held, sway);
      spinner(x, HANDS.x, 40, clock);
    } else {
      // Putting them away: she looks at the shelf while they fly to it.
      drawChibi(x, "love", clock, variant, {
        ...o,
        arms: held.length ? HOLD : undefined,
        eyes: held.length ? "open" : "happy",
        look: held.length ? [16, -2] : undefined,
        skipFx: new Set(["hearts"]),
      });
      if (held.length) pile(x, HANDS.x, HANDS.y + 60, 115, 140, held, Math.sin(clock * 2) * 1.5);
    }
    x.restore();
    return true;
  }

  /**
   * The files in the air, the burst of each catch and the copy bar, over the
   * page. The geometry is asked only then: measuring the page every frame while
   * files merely hover would be layout work for nothing.
   */
  drawOverlay(x: Ctx, geometry: () => CatchGeometry, clock: number, variant: MikuVariantId) {
    const t = this.since();
    if (t == null) return;
    const tl = catchTimeline(this.files);
    if (t >= tl.done) return;
    const g = geometry();
    const files = this.files;

    // Falling into her hands.
    files.slice(0, tl.m).forEach((f, i) => {
      const s0 = i * STAGGER;
      if (t < s0 || t >= s0 + FALL) return;
      const e = eIn((t - s0) / FALL);
      const fx = g.from.x + ((i % 3) - 1) * 14;
      fileIcon(x, lerp(fx, g.hands.x, e), lerp(g.from.y, g.hands.y - 6, e), 26, 32, f.name, lerp(-0.12, (i % 2 ? -1 : 1) * 0.5, e));
    });
    if (files.length > tl.m && t >= FALL && t < tl.ready) badge(x, g.hands.x + 22, g.hands.y - 30, `+${files.length - tl.m}`);

    // A burst and a "+1" for every catch.
    for (const land of tl.landings) {
      const k = (t - land) / 0.6;
      if (k < 0 || k >= 1) continue;
      sparkle(x, g.hands.x, g.hands.y - 4, k);
      plusOne(x, g.hands.x + 24, g.hands.y - 30 - k * 22, k);
    }

    // Each one flies from her hands to its own tile, once its copy is done.
    files.forEach((f, i) => {
      if (i >= FLYERS) return;
      const e = (t - tl.flyAt[i]) / PUT_FLY;
      if (e < 0 || e >= 1) return;
      const to = g.tileAt(f.name) ?? { x: g.from.x, y: g.from.y + 40 };
      const k = eOut(e);
      fileIcon(x, lerp(g.hands.x, to.x, k), lerp(g.hands.y - 6, to.y, k) - Math.sin(e * Math.PI) * 46, lerp(26, 22, k), lerp(32, 28, k), f.name, (1 - k) * 0.6);
    });

    if (g.bar && this.barShown) this.drawBar(x, g.bar, t, tl.allAt, clock, variant);
  }

  /** The copy bar, a little Miku running it; at 100 % it shines and she jumps. */
  private drawBar(x: Ctx, b: { x: number; y: number; w: number }, t: number, allAt: number, clock: number, variant: MikuVariantId) {
    const files = this.files;
    const total = files.reduce((s, f) => s + (f.copied != null ? 1 : f.progress), 0) / files.length;
    // Eased by time, not by frame: a window in the background draws few frames.
    this.shownTotal += (total - this.shownTotal) * (1 - Math.exp(-Math.max(0, t - this.shownAt) * 10));
    this.shownAt = t;
    const fill = total >= 1 ? 1 : this.shownTotal;
    const dk = t >= allAt ? clamp((t - allAt) / DONE_T) : -1;
    const H = 5;

    x.save();
    x.fillStyle = "#1a2236";
    x.beginPath();
    x.roundRect(b.x, b.y, b.w, H, H / 2);
    x.fill();
    const grad = x.createLinearGradient(b.x, 0, b.x + b.w, 0);
    grad.addColorStop(0, TEAL);
    grad.addColorStop(1, PINK);
    if (dk >= 0) {
      x.shadowColor = PINK;
      x.shadowBlur = 10 * (1 - dk) + 4;
    }
    x.fillStyle = grad;
    x.beginPath();
    x.roundRect(b.x, b.y, Math.max(H, b.w * fill), H, H / 2);
    x.fill();
    x.restore();
    if (dk >= 0 && dk < 1) {
      // A white shine sweeps the bar once, and sparks burst where it ends.
      const sx = b.x + b.w * eOut(dk);
      const shine = x.createLinearGradient(sx - 30, 0, sx + 6, 0);
      shine.addColorStop(0, "rgba(255,255,255,0)");
      shine.addColorStop(1, "rgba(255,255,255,0.9)");
      x.save();
      x.beginPath();
      x.roundRect(b.x, b.y, b.w, H, H / 2);
      x.clip();
      x.fillStyle = shine;
      x.fillRect(sx - 30, b.y, 36, H);
      x.restore();
      sparkle(x, b.x + b.w, b.y + 2, dk, 8, 1.6);
    }

    // The runner: a tiny Miku bobbing along the fill, a file in her arms; at
    // 100 % she jumps for joy with it over her head.
    const rk = 30 / CHIBI_H;
    const jump = dk >= 0 ? Math.abs(Math.sin(clamp(dk * 2) * Math.PI)) * 10 : Math.abs(Math.sin(clock * 12)) * 2;
    const carried = files.find((f) => f.copied == null)?.name ?? files[files.length - 1].name;
    x.save();
    x.translate(b.x + b.w * fill - 260 * rk, b.y - 1 - jump - 480 * rk);
    x.scale(rk, rk);
    if (dk >= 0) {
      drawChibi(x, "finished", clock, variant, { noShadow: true });
      fileIcon(x, 260, 120, 150, 180, carried, Math.sin(clock * 8) * 0.15);
    } else {
      drawChibi(x, "happy", clock, variant, { noShadow: true, arms: HOLD });
      fileIcon(x, 260, 370, 150, 180, carried);
    }
    x.restore();

    x.save();
    x.textAlign = "right";
    x.textBaseline = "alphabetic";
    if (dk >= 0) {
      const pop = clamp(eBack(clamp(dk / 0.35)), 0, 1.2);
      x.translate(b.x + b.w, b.y + 15);
      x.scale(pop, pop);
      x.fillStyle = TEAL;
      x.font = '800 11px "Segoe UI", sans-serif';
      x.fillText(`✓ ${this.doneLabel}`, 0, 0);
    } else {
      x.fillStyle = "#8fa3b8";
      x.font = "600 10px ui-monospace, Consolas, monospace";
      x.fillText(`${Math.round(fill * 100)}%`, b.x + b.w, b.y + 15);
    }
    x.restore();
  }

  /** The bar's "Done!", in the user's language (the deck sets it). */
  doneLabel = "";
}

/** The one catch: the island starts it, the deck draws it. */
export const Catch = new ShelfCatch();

// ── Drawing ───────────────────────────────────────────────────────────────────

/** A document: a page with a folded corner and its type on a coloured tag. */
function fileIcon(x: Ctx, cx: number, cy: number, w: number, h: number, name: string, rot = 0) {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  const fold = w * 0.32;
  x.beginPath();
  x.moveTo(-w / 2, -h / 2 + 3);
  x.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + 3, -h / 2);
  x.lineTo(w / 2 - fold, -h / 2);
  x.lineTo(w / 2, -h / 2 + fold);
  x.lineTo(w / 2, h / 2 - 3);
  x.quadraticCurveTo(w / 2, h / 2, w / 2 - 3, h / 2);
  x.lineTo(-w / 2 + 3, h / 2);
  x.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - 3);
  x.closePath();
  x.fillStyle = "#F4F6F9";
  x.fill();
  x.strokeStyle = "rgba(0,0,0,0.12)";
  x.lineWidth = Math.max(0.6, w * 0.02);
  x.stroke();
  x.fillStyle = "#C9D0DA";
  x.beginPath();
  x.moveTo(w / 2 - fold, -h / 2);
  x.lineTo(w / 2 - fold, -h / 2 + fold);
  x.lineTo(w / 2, -h / 2 + fold);
  x.closePath();
  x.fill();
  x.fillStyle = "#D5DBE3";
  for (let i = 0; i < 3; i++) x.fillRect(-w / 2 + w * 0.16, -h / 2 + h * (0.34 + i * 0.13), w * (i === 2 ? 0.4 : 0.66), Math.max(1, h * 0.05));
  x.fillStyle = colorOf(name);
  x.beginPath();
  x.roundRect(-w / 2 - w * 0.08, h / 2 - h * 0.34, w * 0.78, h * 0.24, Math.max(1, w * 0.06));
  x.fill();
  const tag = tagOf(name);
  if (h >= 18 && tag) {
    x.fillStyle = "#fff";
    x.font = `700 ${Math.round(h * 0.16)}px "Segoe UI", sans-serif`;
    x.textBaseline = "middle";
    x.fillText(tag, -w / 2 + w * 0.02, h / 2 - h * 0.22);
  }
  x.restore();
}

const FAN = [0, -0.16, 0.14, -0.08, 0.2, -0.22, 0.1];
/** A fanned stack of files, bottom first, in her design units. */
function pile(x: Ctx, cx: number, bottom: number, w: number, h: number, names: string[], sway: number) {
  names.forEach((name, i) => {
    const lift = i * h * 0.06;
    const dx = ((i % 3) - 1) * w * 0.12 + sway * i * 0.4;
    fileIcon(x, cx + dx, bottom - h / 2 - lift, w, h, name, FAN[i % FAN.length] + sway * 0.01 * i);
  });
}

function badge(x: Ctx, bx: number, by: number, label: string) {
  x.save();
  x.fillStyle = PINK;
  x.beginPath();
  x.arc(bx, by, 8.5, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = "#0A0F11";
  x.lineWidth = 2;
  x.stroke();
  x.fillStyle = "#fff";
  x.font = '700 10px "Segoe UI", sans-serif';
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(label, bx, by + 0.5);
  x.restore();
}

/** A ring of pink and yellow rays bursting out, `k` = 0–1 through it. */
function sparkle(x: Ctx, sx: number, sy: number, k: number, rays = 6, size = 1) {
  x.save();
  x.globalAlpha = 1 - k;
  x.lineWidth = 2;
  x.lineCap = "round";
  const r0 = (4 + k * 6) * size;
  const r1 = (8 + k * 10) * size;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    x.strokeStyle = i % 2 ? PINK : "#F5C542";
    x.beginPath();
    x.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0);
    x.lineTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1);
    x.stroke();
  }
  x.restore();
}

/** "+1" in Miku pink, popping up from her hands on each catch. */
function plusOne(x: Ctx, px: number, py: number, k: number) {
  x.save();
  x.globalAlpha = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
  x.translate(px, py);
  const s = 0.8 + 0.4 * eBack(clamp(k / 0.3));
  x.scale(s, s);
  x.font = '800 13px "Segoe UI", sans-serif';
  x.textAlign = "center";
  x.lineWidth = 3;
  x.strokeStyle = "#0A0F11";
  x.strokeText("+1", 0, 0);
  x.fillStyle = PINK;
  x.fillText("+1", 0, 0);
  x.restore();
}

/** Three dots circling over her head while the copies run, in her design units. */
function spinner(x: Ctx, cx: number, cy: number, clock: number) {
  x.save();
  x.globalAlpha = 0.9;
  for (let i = 0; i < 3; i++) {
    const a = clock * 5 + (i * Math.PI * 2) / 3;
    x.fillStyle = i ? TEAL : PINK;
    x.beginPath();
    x.arc(cx + Math.cos(a) * 15, cy + Math.sin(a) * 6, 4.5, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}
