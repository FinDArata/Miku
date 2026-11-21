// Small things Miku holds (dev/pc-notif-mockup.html, dev/notif-page-mockup.html):
// the "!" card a plain PC notice drops into her hands, and her phone on the
// Notif page while something is unread. Design units, drawn over drawChibi
// with her arms in HOLD_ARMS; the accent follows her skin.

import { drawChibi } from "./chibi";
import type { MikuVariantId } from "./variants";
import { themeFor } from "../theme/skins";

/** Arms cupped in front of her: what she holds sits at about (260, 370). */
export const HOLD_ARMS = [15, -70, -15, 70] as const;
/** The "!" of something new, as on the Notif page's unread marks. */
const PINK = "#E12885";

type Ctx = CanvasRenderingContext2D;

/** A scrap of dark glass with a pink "!", centred on (cx, cy). */
export function drawAlertCard(x: Ctx, cx: number, cy: number, s: number, rot: number, accent: string) {
  if (s <= 0) return;
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  x.scale(s, s);
  x.fillStyle = "#0f1a1c";
  x.strokeStyle = accent;
  x.lineWidth = 6;
  x.beginPath();
  x.roundRect(-66, -46, 132, 92, 22);
  x.fill();
  x.stroke();
  x.fillStyle = PINK;
  x.font = "900 64px 'Segoe UI', sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText("!", 0, 4);
  x.restore();
}

/** Her phone in both hands, a pink "!" banner on it; a short buzz every few seconds. */
export function drawPhone(x: Ctx, clock: number, accent: string, still = false) {
  const buzz = !still && clock % 3.2 < 0.35;
  x.save();
  x.translate(260 + (buzz ? Math.sin(clock * 90) * 4 : 0), 368);
  x.rotate(-0.06);
  x.scale(0.78, 0.78);
  x.fillStyle = "#1a2230";
  x.strokeStyle = accent;
  x.lineWidth = 5;
  x.beginPath();
  x.roundRect(-36, -62, 72, 124, 16);
  x.fill();
  x.stroke();
  const screen = x.createLinearGradient(0, -52, 0, 52);
  screen.addColorStop(0, "#15434a");
  screen.addColorStop(1, "#0a1416");
  x.fillStyle = screen;
  x.beginPath();
  x.roundRect(-28, -52, 56, 100, 9);
  x.fill();
  x.fillStyle = PINK;
  x.beginPath();
  x.roundRect(-24, -44, 48, 28, 8);
  x.fill();
  x.fillStyle = "#fff";
  x.font = "900 22px 'Segoe UI', sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText("!", -13, -29);
  x.fillStyle = "rgba(255,255,255,0.85)";
  x.fillRect(-3, -37, 20, 4);
  x.fillRect(-3, -27, 13, 4);
  x.globalAlpha = 0.4;
  x.fillStyle = accent;
  x.fillRect(-20, -4, 40, 5);
  x.fillRect(-20, 8, 28, 5);
  x.globalAlpha = 1;
  // Her hands on its sides, so it reads as held.
  x.fillStyle = "#fbe3d6";
  x.strokeStyle = "#d9a994";
  x.lineWidth = 3;
  for (const d of [-1, 1]) {
    x.beginPath();
    x.ellipse(d * 34, 22, 12, 15, 0, 0, Math.PI * 2);
    x.fill();
    x.stroke();
  }
  if (buzz) {
    x.strokeStyle = PINK;
    x.lineWidth = 5;
    x.lineCap = "round";
    for (const d of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        x.beginPath();
        x.moveTo(d * (50 + i * 12), -22 + i * 8);
        x.lineTo(d * (50 + i * 12), 2 + i * 8);
        x.stroke();
      }
    }
  }
  x.restore();
}

/** The Notif page while something is unread: head down over her buzzing phone. */
export function drawHoldingPhone(x: Ctx, clock: number, variant: MikuVariantId, still = false) {
  drawChibi(x, "idle", clock, variant, {
    noShadow: true,
    arms: HOLD_ARMS,
    eyes: "open",
    pitch: 0.35,
    look: [still ? 0 : Math.sin(clock * 1.4) * 6, 14],
  });
  drawPhone(x, clock, themeFor(variant).accent, still);
}
