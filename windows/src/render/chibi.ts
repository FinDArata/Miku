// Pose sheet for the Miku chibi (src/mochi/chibi.ts): every pose, animated, on
// one page. Not in the Vite build inputs — dev-only, served at /chibi.html.
// Query params: variant (classic|snow|sakura), pose (show one), size (px), bg,
// greeting=1 (loop the launch greeting above the sheet).

import { CHIBI_H, CHIBI_POSES, CHIBI_W, drawChibi, type ChibiPose } from "../mochi/chibi";
import { Greeting, GREETING_H, GREETING_W } from "../mochi/greeting";
import { DEFAULT_VARIANT, isMikuVariant } from "../mochi/variants";

const q = new URLSearchParams(location.search);
const v = q.get("variant");
const variant = isMikuVariant(v) ? v : DEFAULT_VARIANT;
const only = q.get("pose");
const size = Number(q.get("size") ?? (only ? 480 : 170));
if (q.get("bg")) document.body.style.background = q.get("bg")!;

const dpr = window.devicePixelRatio || 1;
const grid = document.querySelector<HTMLElement>("#grid")!;

if (q.get("greeting")) {
  const canvas = document.createElement("canvas");
  canvas.width = GREETING_W * dpr;
  canvas.height = GREETING_H * dpr;
  canvas.style.cssText = `display:block;width:${GREETING_W}px;background:#000;border-radius:24px;margin-bottom:12px`;
  grid.before(canvas);
  const ctx = canvas.getContext("2d")!;
  const greeting = new Greeting();
  greeting.setVariant(variant);
  greeting.start();
  setInterval(() => greeting.start(), 6500);
  const loop = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    greeting.draw(ctx);
    requestAnimationFrame(loop);
  };
  loop();
}

const all = Object.keys(CHIBI_POSES) as ChibiPose[];
const poses = only && only in CHIBI_POSES ? [only as ChibiPose] : all;

const stages = poses.map((pose) => {
  const cell = document.createElement("figure");
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round((size * CHIBI_H / CHIBI_W) * dpr);
  canvas.style.width = `${size}px`;
  const label = document.createElement("figcaption");
  label.textContent = pose;
  cell.append(canvas, label);
  grid.append(cell);
  return { pose, canvas, ctx: canvas.getContext("2d")! };
});

function frame(ms: number) {
  for (const { pose, canvas, ctx } of stages) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(canvas.width / CHIBI_W, canvas.width / CHIBI_W);
    drawChibi(ctx, pose, ms / 1000, variant);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
