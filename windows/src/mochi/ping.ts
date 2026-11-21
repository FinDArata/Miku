// Miku gets a message (dev/notif-miku-mockup.html): her headset rings, a chat
// bubble pops up by her ear and drops into her hands, she reads it and smiles.
// One frame at `t` seconds since the message arrived, in the chibi's design
// space, with PING_TOP units of headroom over her head for the bubble: the
// caller translates by PING_TOP and scales, as for drawChibi.

import { CHIBI_H, drawChibi } from "./chibi";
import { HOLD_ARMS, drawAlertCard } from "./props";
import type { MikuVariantId } from "./variants";
import { themeFor } from "../theme/skins";

/** Headroom over her head (design units) the bubble needs. */
export const PING_TOP = 70;

const PINK = "#E12885";
const TEAL = "#39C5BB";
const HOLD = HOLD_ARMS;
/** Her headset's earpieces, design units. */
const EARS: readonly (readonly [number, number])[] = [[140, 242], [380, 242]];

const T_PING = 0.6;
const T_FALL = 1.3;
const T_HOLD = 1.9;
const T_SMILE = 4.1;
const T_DONE = 5.2;

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const eBack = (k: number) => 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2);

type Ctx = CanvasRenderingContext2D;

function bubble(x: Ctx, cx: number, cy: number, s: number, rot: number, read: boolean) {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  x.scale(s, s);
  x.fillStyle = "#F4FBFA";
  x.beginPath();
  x.roundRect(-70, -48, 140, 92, 26);
  x.fill();
  x.beginPath();
  x.moveTo(-34, 40);
  x.lineTo(-50, 66);
  x.lineTo(-8, 42);
  x.closePath();
  x.fill();
  x.fillStyle = "#C8D6D8";
  x.beginPath();
  x.roundRect(-46, -22, 92, 12, 6);
  x.roundRect(-46, 0, 60, 12, 6);
  x.fill();
  if (!read) {
    x.fillStyle = PINK;
    x.beginPath();
    x.arc(62, -42, 22, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "#fff";
    x.font = "800 28px 'Segoe UI', sans-serif";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText("1", 62, -40);
  }
  x.restore();
}

/** Sound rings out of both earpieces. */
function rings(x: Ctx, clock: number, a: number) {
  if (a <= 0) return;
  x.save();
  x.lineCap = "round";
  for (const [ex, ey] of EARS) {
    const mid = ex < 260 ? Math.PI : 0;
    for (let i = 0; i < 3; i++) {
      const k = (clock * 1.6 + i / 3) % 1;
      x.globalAlpha = a * (1 - k);
      x.strokeStyle = i % 2 ? TEAL : PINK;
      x.lineWidth = 9 - k * 4;
      x.beginPath();
      x.arc(ex, ey, 16 + k * 60, mid - 0.7, mid + 0.7);
      x.stroke();
    }
  }
  x.restore();
}

/**
 * Paint the ping at `t` seconds since arrival; `clock` drives her idle motion.
 * After it plays she keeps holding the (read) bubble, glancing over it.
 */
export function drawPing(x: Ctx, t: number, clock: number, variant: MikuVariantId) {
  const ringA = t >= T_PING && t < T_HOLD + 0.4 ? clamp((t - T_PING) / 0.15) * clamp((T_HOLD + 0.4 - t) / 0.4) : 0;
  const hop = t >= T_PING && t < T_PING + 0.35 ? Math.sin(((t - T_PING) / 0.35) * Math.PI) * 26 : 0;
  x.save();
  x.translate(0, PING_TOP - hop);
  const o = { noShadow: true } as const;
  if (t < T_PING) drawChibi(x, "idle", clock, variant, { ...o, eyes: "happy" });
  else if (t < T_FALL) drawChibi(x, "surprised", clock, variant, { ...o, look: [10, -10], skipFx: new Set(["lines"]) });
  else if (t < T_HOLD) drawChibi(x, "idle", clock, variant, { ...o, arms: HOLD, look: [0, 10] });
  else if (t < T_SMILE || t >= T_DONE) drawChibi(x, "idle", clock, variant, { ...o, arms: HOLD, look: [Math.sin(clock * 3.2) * 7, 12] });
  else drawChibi(x, "love", clock, variant, { ...o, arms: HOLD, eyes: "happy", skipFx: new Set(["hearts"]) });
  rings(x, clock, ringA);
  if (t >= T_PING) {
    const pop = eBack(clamp((t - T_PING) / 0.35));
    const fall = clamp((t - T_FALL) / (T_HOLD - T_FALL)) ** 2;
    const sway = t >= T_HOLD ? Math.sin(clock * 2) * 0.03 : 0;
    bubble(x, lerp(400, 260, fall), lerp(110, 372, fall), lerp(0.9, 0.62, fall) * pop, lerp(0.12, -0.05, fall) + sway, t >= T_SMILE);
  }
  x.restore();
}

/**
 * A plain PC notice (dev/pc-notif-mockup.html): she drops out of the capsule
 * with a "!" over her head, her headset rings, a "!" card floats down into her
 * hands, she reads it and smiles. Same headroom and frame as drawPing.
 */
export function drawDrop(x: Ctx, t: number, clock: number, variant: MikuVariantId) {
  const T_LAND = 0.5, T_CARD = 0.75, T_DOWN = 1.25, T_READ = 1.75;
  const land = eBack(clamp(t / T_LAND));
  x.save();
  x.translate(0, PING_TOP - (1 - land) * (CHIBI_H + PING_TOP));
  const o = { noShadow: true } as const;
  if (t < T_CARD) drawChibi(x, "approval", clock, variant, o);
  else if (t < T_DOWN) {
    const k = clamp((t - T_CARD) / (T_DOWN - T_CARD));
    drawChibi(x, "question", clock, variant, { ...o, arms: HOLD, look: [lerp(12, 0, k), lerp(-12, 12, k)], skipFx: new Set(["question"]) });
  } else if (t < T_READ) drawChibi(x, "idle", clock, variant, { ...o, arms: HOLD, eyes: "open", look: [Math.sin(clock * 3.2) * 7, 12] });
  else drawChibi(x, "happy", clock, variant, o);
  rings(x, clock, t > 0.2 && t < T_DOWN + 0.3 ? 1 - clamp((t - T_DOWN) / 0.3) : 0);
  if (t > 0.3 && t < T_READ) {
    const pop = eBack(clamp((t - 0.3) / 0.25));
    const fall = clamp((t - T_CARD) / (T_DOWN - T_CARD)) ** 2;
    const fade = 1 - clamp((t - (T_READ - 0.2)) / 0.2);
    drawAlertCard(x, lerp(420, 260, fall), lerp(110 + Math.sin(clock * 4) * 6, 372, fall), lerp(0.8, 0.62, fall) * pop * fade, lerp(0.12, -0.05, fall), themeFor(variant).accent);
  }
  x.restore();
}
