// One-off render page: draws the real Mochi (BotEngine) at a large size on a
// transparent canvas for export to PNG. Not in the Vite build inputs — dev-only,
// served by `npm run dev` at /render.html. Driven over CDP by the render script.

import { BotEngine, hexToRGB } from "../mochi/engine";
import { resolveOutfit, type OutfitSelection } from "../mochi/wardrobe";
import { MIKU_VARIANTS, type MikuVariantId } from "../mochi/variants";
import type { BotStateName } from "../core/layout";

/** Query params: size, state, variant, outfit. */
const q = new URLSearchParams(location.search);
const SIZE = Number(q.get("size") ?? 1024);
const STATE = (q.get("state") ?? "idle") as BotStateName;
const VARIANT = (q.get("variant") ?? "classic") as MikuVariantId;
const OUTFIT = (q.get("outfit") ?? "none") as OutfitSelection;

const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
canvas.width = SIZE;
canvas.height = SIZE;
canvas.style.width = `${SIZE}px`;
canvas.style.height = `${SIZE}px`;

const engine = new BotEngine();
engine.setVariant(MIKU_VARIANTS[VARIANT] ? VARIANT : "classic");
engine.setOutfit(resolveOutfit(OUTFIT, new Date()), false);
engine.bodyColor = hexToRGB("#F5F6F8");
engine.setState(STATE, true);
// Give the state's one-shot animations (drops, emotes) time to settle, then
// draw exactly one settled frame with her looking straight ahead.
engine.lookX = 0;
engine.lookY = 0;

const settleMs = Number(q.get("settle") ?? 1200);
setTimeout(() => {
  engine.update(0.016);
  engine.draw(canvas.getContext("2d")!, SIZE, SIZE);
  if (q.get("crop") === "head") {
    // Face-only export: crop a square around the head. The engine centres the
    // body at (W/2, H/2 + overhang/2 + …) and the head sits at headY above it
    // (see BotEngine.draw / drawOutfit* anchoring), so the crop is computed
    // from the same geometry, widened to keep the twin-tails and headset.
    const R = SIZE * 0.3;
    const u = R / 158;
    // `lift` nudges the crop centre up (fraction of SIZE) to leave the collar out.
    const lift = SIZE * Number(q.get("lift") ?? 0.03);
    const headCY = SIZE / 2 + engine.particleOverhang / 2 + R * 0.06 - (150 - 64) * u - lift;
    const half = SIZE * Number(q.get("zoom") ?? 0.24);
    // `hzoom` narrows the crop horizontally (fraction of `half`): less empty
    // space at the sides for a tighter portrait.
    const halfW = half * Number(q.get("hzoom") ?? 1);
    // `extend` stretches the crop downward past a square (fraction of half),
    // so the chin fits without dragging the collar in.
    const extend = Number(q.get("extend") ?? 0);
    const cropW = halfW * 2;
    const cropH = half * 2 * (1 + extend);
    // Output canvas keeps the crop's own aspect: no stretching on either axis.
    // WIDTH is normalized to SIZE; height follows (a narrower hzoom then also
    // yields a taller canvas, instead of a squashed image).
    const out = document.createElement("canvas");
    out.width = SIZE;
    out.height = Math.round(cropH * (SIZE / cropW));
    const octx = out.getContext("2d")!;
    octx.drawImage(canvas, SIZE / 2 - halfW, headCY - half, cropW, cropH, 0, 0, out.width, out.height);
    // Replace the stage canvas's bitmap with the crop (same element, so the
    // CDP export that reads #stage gets the cropped result at true aspect).
    canvas.width = out.width;
    canvas.height = out.height;
    canvas.style.width = `${out.width}px`;
    canvas.style.height = `${out.height}px`;
    canvas.getContext("2d")!.drawImage(out, 0, 0);
    if (q.get("clean") === "1") {
      // The collar peeks in below the chin no matter the crop (they overlap).
      // Erase near-white pixels FLOODED FROM THE BOTTOM EDGE: the collar always
      // touches it, the chin (skin, not white) never qualifies. cleanFrom caps
      // the flood to the bottom strip as a safety net.
      const ctx = canvas.getContext("2d")!;
      const stripTop = Math.round(out.height * Number(q.get("cleanFrom") ?? 0.84));
      const thresh = Number(q.get("cleanThresh") ?? 225);
      const img = ctx.getImageData(0, stripTop, out.width, out.height - stripTop);
      const d = img.data;
      const w = out.width;
      const h = out.height - stripTop;
      const isWhite = (p: number) => d[p] > thresh && d[p + 1] > thresh && d[p + 2] > thresh;
      const flood = new Uint8Array(w * h);
      const queue: number[] = [];
      for (let x = 0; x < w; x++) {
        const p = (h - 1) * w + x;
        if (isWhite(p * 4)) { flood[p] = 1; queue.push(p); }
      }
      while (queue.length) {
        const p = queue.pop()!;
        const px = p % w, py = (p - px) / w;
        for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]] as const) {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const np = ny * w + nx;
          if (!flood[np] && isWhite(np * 4)) { flood[np] = 1; queue.push(np); }
        }
      }
      for (let p = 0; p < flood.length; p++) if (flood[p]) d[p * 4 + 3] = 0;
      ctx.putImageData(img, 0, stripTop);
    }
  }
  // Signal completion: the title carries the export payload size.
  document.title = `render-done:${SIZE}`;
}, settleMs);
