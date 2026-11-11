// Anime-style Miku prototype: a programmatically drawn, anime-proportioned
// Hatsune Miku (long flowing twin-tails, jagged bangs, large anime eyes, the
// official shirt/tie/sleeves/skirt). One settled static frame for export —
// a styling study toward reworking the live BotEngine's look (option 2).

const q = new URLSearchParams(location.search);
const W = Number(q.get("w") ?? 1200);
const H = Number(q.get("h") ?? 1800);
const SMILE = q.get("smile") === "1";

const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
canvas.width = W;
canvas.height = H;

// ── Palette ────────────────────────────────────────────────────────────────────
const SKIN = "#FFF2E8";
const SKIN_SHADE = "#F5D9C8";
const HAIR = "#3EC9BF";
const HAIR_DARK = "#279E96";
const HAIR_DEEP = "#1B7B75";
const HAIR_LIGHT = "#8FEDE4";
const LINE = "#233533";
const TIE = "#2FB8AE";
const SHIRT = "#F7FAF9";
const SLEEVE = "#2A2E33";
const SKIRT = "#454A52";
const EYE_TOP = "#0E4A46";
const EYE_BOT = "#37B8AE";

const ctx = canvas.getContext("2d")!;

/** Smooth curve through points (Catmull-Rom → bezier), the anime silhouette workhorse. */
function curve(pts: [number, number][], close = false) {
  ctx.beginPath();
  const n = pts.length;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1]);
  }
  if (close) ctx.closePath();
}

function fill(color: string) {
  ctx.fillStyle = color;
  ctx.fill();
}

function outline(width = 5, color = LINE) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

// ── Layout (anime proportions: big head, compact body) ─────────────────────────
const cx = W / 2;
const headR = W * 0.2; // head half-width — larger head, anime look
const headCY = H * 0.17; // head centre y
const chinY = headCY + headR * 1.08;
const neckY = chinY + headR * 0.18;
const shoulderY = neckY + headR * 0.3;
const hipY = H * 0.55;
const bodyHalf = headR * 0.66; // torso half-width

// ══ TWIN TAILS (behind everything) ═════════════════════════════════════════════
for (const side of [-1, 1]) {
  const mountX = cx + side * headR * 0.86;
  const mountY = headCY - headR * 0.42;
  // The big flowing tail: wide at the mount, sweeping out and down, pointed tip.
  const tail = (inset: number, swing: number) =>
    [
      [mountX + side * headR * 0.1, mountY - headR * 0.15],
      [mountX + side * headR * (0.9 + inset * 0.2), mountY + headR * 0.35],
      [cx + side * W * (0.3 + swing) - side * inset * headR, headCY + headR * 1.8],
      [cx + side * W * (0.34 + swing * 1.3) - side * inset * headR, headCY + headR * 3.4],
      [cx + side * W * (0.24 + swing * 1.1) - side * inset * headR, H * 0.94],
    ] as [number, number][];
  // dark under-layer, then main, then highlight streak
  curve(tail(0.55, -0.02)); fill(HAIR_DEEP);
  curve(tail(0, 0)); fill(HAIR);
  curve(
    [
      [mountX + side * headR * 0.3, mountY - headR * 0.02],
      [mountX + side * headR * 0.62, mountY + headR * 0.7],
      [cx + side * W * 0.24, headCY + headR * 2.0],
      [cx + side * W * 0.24, headCY + headR * 3.2],
      [cx + side * W * 0.19, H * 0.9],
    ],
  );
  ctx.save();
  ctx.clip();
  ctx.fillStyle = HAIR_LIGHT;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.ellipse(cx + side * W * 0.26, headCY + headR * 2.2, W * 0.045, headR * 2.4, side * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
  // tail ties (the red-black hair bands)
  ctx.save();
  ctx.translate(mountX + side * headR * 0.25, mountY + headR * 0.18);
  ctx.rotate(side * 0.5);
  ctx.beginPath();
  ctx.ellipse(0, 0, headR * 0.16, headR * 0.1, 0, 0, Math.PI * 2);
  fill("#2A2E33");
  ctx.beginPath();
  ctx.ellipse(0, -headR * 0.02, headR * 0.16, headR * 0.1, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "#D63964";
  ctx.lineWidth = headR * 0.05;
  ctx.stroke();
  ctx.restore();
}

// ══ BACK HAIR (behind head, the inner mass) ════════════════════════════════════
curve(
  [
    [cx - headR * 1.02, headCY + headR * 0.2],
    [cx - headR * 0.95, chinY + headR * 0.5],
    [cx - headR * 0.5, chinY + headR * 0.95],
    [cx, chinY + headR * 1.05],
    [cx + headR * 0.5, chinY + headR * 0.95],
    [cx + headR * 0.95, chinY + headR * 0.5],
    [cx + headR * 1.02, headCY + headR * 0.2],
  ],
);
fill(HAIR_DARK);

// ══ BODY (neck, shoulders, torso, arms, skirt) ════════════════════════════════
// Neck
ctx.beginPath();
ctx.rect(cx - headR * 0.16, chinY - headR * 0.1, headR * 0.32, neckY - chinY + headR * 0.3);
fill(SKIN);
ctx.fillStyle = SKIN_SHADE;
ctx.fillRect(cx - headR * 0.16, chinY - headR * 0.1, headR * 0.32, headR * 0.16);

// Torso: the sleeveless white shirt
curve(
  [
    [cx - bodyHalf * 0.9, shoulderY],
    [cx - bodyHalf * 1.05, shoulderY + headR * 0.55],
    [cx - bodyHalf * 0.92, hipY - headR * 0.1],
    [cx, hipY],
    [cx + bodyHalf * 0.92, hipY - headR * 0.1],
    [cx + bodyHalf * 1.05, shoulderY + headR * 0.55],
    [cx + bodyHalf * 0.9, shoulderY],
    [cx + headR * 0.24, neckY - headR * 0.1],
    [cx - headR * 0.24, neckY - headR * 0.1],
  ],
  true,
);
fill(SHIRT);
outline(4);

// Shirt shading along the sides
ctx.save();
ctx.clip();
ctx.globalAlpha = 0.12;
ctx.fillStyle = "#8FA6A3";
ctx.beginPath();
ctx.ellipse(cx - bodyHalf * 0.85, shoulderY + headR, headR * 0.3, headR * 1.4, 0.1, 0, Math.PI * 2);
ctx.fill();
ctx.beginPath();
ctx.ellipse(cx + bodyHalf * 0.85, shoulderY + headR, headR * 0.3, headR * 1.4, -0.1, 0, Math.PI * 2);
ctx.fill();
ctx.globalAlpha = 1;
ctx.restore();

// Collar
curve(
  [
    [cx - headR * 0.34, neckY - headR * 0.12],
    [cx - headR * 0.4, neckY + headR * 0.2],
    [cx - headR * 0.1, neckY + headR * 0.34],
    [cx, neckY + headR * 0.2],
    [cx + headR * 0.1, neckY + headR * 0.34],
    [cx + headR * 0.4, neckY + headR * 0.2],
    [cx + headR * 0.34, neckY - headR * 0.12],
  ],
  true,
);
fill("#EAF1EF");
outline(3);

// Tie
curve(
  [
    [cx, neckY + headR * 0.18],
    [cx - headR * 0.14, neckY + headR * 0.5],
    [cx - headR * 0.09, shoulderY + headR * 0.85],
    [cx, shoulderY + headR * 1.15],
    [cx + headR * 0.09, shoulderY + headR * 0.85],
    [cx + headR * 0.14, neckY + headR * 0.5],
  ],
  true,
);
fill(TIE);
outline(3);

// Arms: bare shoulders → black detached sleeves below the elbow
for (const side of [-1, 1]) {
  const sx = cx + side * bodyHalf * 0.92;
  // upper arm (skin)
  curve(
    [
      [sx, shoulderY + headR * 0.06],
      [cx + side * bodyHalf * 1.24, shoulderY + headR * 0.42],
      [cx + side * bodyHalf * 1.22, shoulderY + headR * 0.88],
      [cx + side * bodyHalf * 1.02, shoulderY + headR * 1.04],
      [sx + side * headR * 0.06, shoulderY + headR * 0.85],
    ],
    true,
  );
  fill(SKIN);
  outline(4);
  // black sleeve from mid-upper-arm to wrist
  curve(
    [
      [cx + side * bodyHalf * 1.16, shoulderY + headR * 0.56],
      [cx + side * bodyHalf * 1.3, shoulderY + headR * 0.78],
      [cx + side * bodyHalf * 1.24, shoulderY + headR * 1.36],
      [cx + side * bodyHalf * 1.02, shoulderY + headR * 1.6],
      [cx + side * bodyHalf * 0.92, shoulderY + headR * 1.36],
      [cx + side * bodyHalf * 0.98, shoulderY + headR * 0.82],
    ],
    true,
  );
  fill(SLEEVE);
  outline(3);
  // sleeve top trim
  ctx.strokeStyle = "#4A5058";
  ctx.lineWidth = headR * 0.07;
  ctx.beginPath();
  ctx.moveTo(cx + side * bodyHalf * 1.08, shoulderY + headR * 0.64);
  ctx.lineTo(cx + side * bodyHalf * 1.22, shoulderY + headR * 0.67);
  ctx.stroke();
  // hand (fist)
  ctx.beginPath();
  ctx.ellipse(cx + side * bodyHalf * 1.08, shoulderY + headR * 1.7, headR * 0.14, headR * 0.16, side * 0.2, 0, Math.PI * 2);
  fill(SKIN);
  outline(4);
  // the "01" red mark on the left arm
  if (side === -1) {
    ctx.save();
    ctx.translate(cx + side * bodyHalf * 1.2, shoulderY + headR * 1.04);
    ctx.rotate(side * 0.12);
    ctx.fillStyle = "#D6394B";
    ctx.font = `800 ${headR * 0.2}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText("01", 0, 0);
    ctx.restore();
  }
}

// Skirt
curve(
  [
    [cx - bodyHalf * 0.9, hipY - headR * 0.05],
    [cx - bodyHalf * 1.42, hipY + headR * 0.8],
    [cx - bodyHalf * 1.34, hipY + headR * 1.02],
    [cx, hipY + headR * 1.08],
    [cx + bodyHalf * 1.34, hipY + headR * 1.02],
    [cx + bodyHalf * 1.42, hipY + headR * 0.8],
    [cx + bodyHalf * 0.9, hipY - headR * 0.05],
  ],
  true,
);
fill(SKIRT);
outline(4);
// pleats
ctx.save();
ctx.clip();
ctx.strokeStyle = "rgba(255,255,255,0.14)";
ctx.lineWidth = headR * 0.05;
for (let i = -3; i <= 3; i++) {
  ctx.beginPath();
  ctx.moveTo(cx + i * bodyHalf * 0.3, hipY);
  ctx.lineTo(cx + i * bodyHalf * 0.44, hipY + headR * 1.0);
  ctx.stroke();
}
ctx.restore();

// ══ HEAD ═══════════════════════════════════════════════════════════════════════
// Face: anime jaw — round skull, tapered chin
curve(
  [
    [cx - headR * 0.98, headCY + headR * 0.1],
    [cx - headR * 1.0, headCY + headR * 0.62],
    [cx - headR * 0.62, chinY - headR * 0.12],
    [cx, chinY + headR * 0.06],
    [cx + headR * 0.62, chinY - headR * 0.12],
    [cx + headR * 1.0, headCY + headR * 0.62],
    [cx + headR * 0.98, headCY + headR * 0.1],
    [cx + headR * 0.9, headCY - headR * 0.45],
    [cx, headCY - headR * 0.85],
    [cx - headR * 0.9, headCY - headR * 0.45],
  ],
  true,
);
fill(SKIN);
outline(5);

// Ears (hidden by headphones mostly)
// Headphone band over the head
ctx.beginPath();
ctx.ellipse(cx, headCY - headR * 0.28, headR * 1.06, headR * 1.0, 0, Math.PI, Math.PI * 2);
ctx.strokeStyle = "#1E2226";
ctx.lineWidth = headR * 0.14;
ctx.stroke();
// Ear pieces
for (const side of [-1, 1]) {
  ctx.save();
  ctx.translate(cx + side * headR * 0.96, headCY + headR * 0.12);
  ctx.rotate(side * 0.08);
  ctx.beginPath();
  ctx.ellipse(0, 0, headR * 0.2, headR * 0.3, 0, 0, Math.PI * 2);
  fill("#22262B");
  outline(3);
  ctx.beginPath();
  ctx.ellipse(0, 0, headR * 0.11, headR * 0.19, 0, 0, Math.PI * 2);
  fill(TIE);
  ctx.restore();
}

// ── FRONT HAIR: jagged bangs + side locks over the face ───────────────────────
// Bangs: scalloped spikes hanging from the crown
curve(
  [
    [cx - headR * 1.02, headCY + headR * 0.12],
    [cx - headR * 1.05, headCY - headR * 0.55],
    [cx - headR * 0.6, headCY - headR * 1.02],
    [cx, headCY - headR * 1.1],
    [cx + headR * 0.6, headCY - headR * 1.02],
    [cx + headR * 1.05, headCY - headR * 0.55],
    [cx + headR * 1.02, headCY + headR * 0.12],
    // spikes down the fringe (right to left) — short, grazing the forehead only
    [cx + headR * 0.72, headCY + headR * 0.12],
    [cx + headR * 0.58, headCY + headR * 0.2],
    [cx + headR * 0.44, headCY + headR * 0.06],
    [cx + headR * 0.3, headCY + headR * 0.4],
    [cx + headR * 0.16, headCY + headR * 0.16],
    [cx + headR * 0.02, headCY + headR * 0.26],
    [cx - headR * 0.14, headCY + headR * 0.18],
    [cx - headR * 0.3, headCY + headR * 0.26],
    [cx - headR * 0.44, headCY + headR * 0.06],
    [cx - headR * 0.58, headCY + headR * 0.22],
    [cx - headR * 0.72, headCY + headR * 0.06],
  ],
  true,
);
fill(HAIR);
outline(5);

// Bangs shine: the anime highlight band across the crown
ctx.save();
// clip to bangs via re-path
curve(
  [
    [cx - headR * 1.02, headCY + headR * 0.12],
    [cx - headR * 1.05, headCY - headR * 0.55],
    [cx - headR * 0.6, headCY - headR * 1.02],
    [cx, headCY - headR * 1.1],
    [cx + headR * 0.6, headCY - headR * 1.02],
    [cx + headR * 1.05, headCY - headR * 0.55],
    [cx + headR * 1.02, headCY + headR * 0.12],
    [cx + headR * 0.72, headCY + headR * 0.12],
    [cx + headR * 0.58, headCY + headR * 0.2],
    [cx + headR * 0.44, headCY + headR * 0.06],
    [cx + headR * 0.3, headCY + headR * 0.4],
    [cx + headR * 0.16, headCY + headR * 0.16],
    [cx + headR * 0.02, headCY + headR * 0.26],
    [cx - headR * 0.14, headCY + headR * 0.18],
    [cx - headR * 0.3, headCY + headR * 0.26],
    [cx - headR * 0.44, headCY + headR * 0.06],
    [cx - headR * 0.58, headCY + headR * 0.22],
    [cx - headR * 0.72, headCY + headR * 0.06],
  ],
  true,
);
ctx.clip();
ctx.globalAlpha = 0.5;
ctx.fillStyle = HAIR_LIGHT;
ctx.beginPath();
ctx.ellipse(cx, headCY - headR * 0.42, headR * 0.72, headR * 0.22, -0.06, 0, Math.PI * 2);
ctx.fill();
ctx.globalAlpha = 0.35;
ctx.beginPath();
ctx.ellipse(cx - headR * 0.4, headCY + headR * 0.05, headR * 0.16, headR * 0.3, 0.3, 0, Math.PI * 2);
ctx.fill();
ctx.beginPath();
ctx.ellipse(cx + headR * 0.42, headCY + headR * 0.02, headR * 0.14, headR * 0.3, -0.3, 0, Math.PI * 2);
ctx.fill();
ctx.globalAlpha = 1;
ctx.restore();

// Side locks framing the face
for (const side of [-1, 1]) {
  curve(
    [
      [cx + side * headR * 0.98, headCY - headR * 0.2],
      [cx + side * headR * 1.12, headCY + headR * 0.4],
      [cx + side * headR * 1.02, chinY + headR * 0.25],
      [cx + side * headR * 0.82, chinY + headR * 0.55],
      [cx + side * headR * 0.72, chinY + headR * 0.2],
      [cx + side * headR * 0.86, headCY + headR * 0.3],
      [cx + side * headR * 0.8, headCY - headR * 0.15],
    ],
    true,
  );
  fill(HAIR);
  outline(4);
}

// ── Face features (drawn AFTER the front hair, so the short bangs never hide
//    the eyes; the fringe only grazes the forehead) ─────────────────────────────
const eyeY = headCY + headR * 0.3;
const eyeDX = headR * 0.42;
const eyeRX = headR * 0.19;
const eyeRY = headR * 0.26;
for (const side of [-1, 1]) {
  const ex = cx + side * eyeDX;
  // white
  ctx.beginPath();
  ctx.ellipse(ex, eyeY, eyeRX, eyeRY, 0, 0, Math.PI * 2);
  fill("#FFFFFF");
  // iris: tall anime iris, dark top → teal bottom
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(ex, eyeY, eyeRX * 0.94, eyeRY * 0.92, 0, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createLinearGradient(0, eyeY - eyeRY, 0, eyeY + eyeRY);
  g.addColorStop(0, EYE_TOP);
  g.addColorStop(0.55, "#1F8C85");
  g.addColorStop(1, EYE_BOT);
  ctx.fillStyle = g;
  ctx.fillRect(ex - eyeRX, eyeY - eyeRY, eyeRX * 2, eyeRY * 2);
  // pupil
  ctx.beginPath();
  ctx.ellipse(ex, eyeY + eyeRY * 0.05, eyeRX * 0.38, eyeRY * 0.42, 0, 0, Math.PI * 2);
  fill("#0B2E2C");
  // bottom light
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.ellipse(ex, eyeY + eyeRY * 0.55, eyeRX * 0.5, eyeRY * 0.3, 0, 0, Math.PI * 2);
  fill("#9FF0E8");
  ctx.globalAlpha = 1;
  // highlights
  ctx.beginPath();
  ctx.ellipse(ex - eyeRX * 0.35, eyeY - eyeRY * 0.4, eyeRX * 0.22, eyeRY * 0.18, -0.4, 0, Math.PI * 2);
  fill("#FFFFFF");
  ctx.beginPath();
  ctx.ellipse(ex + eyeRX * 0.3, eyeY + eyeRY * 0.25, eyeRX * 0.12, eyeRY * 0.1, 0.3, 0, Math.PI * 2);
  fill("#FFFFFF");
  ctx.restore();
  // upper lash line (thick, winged)
  ctx.strokeStyle = LINE;
  ctx.lineWidth = headR * 0.05;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ex - side * eyeRX * 1.05, eyeY - eyeRY * 0.72);
  ctx.quadraticCurveTo(ex, eyeY - eyeRY * 1.18, ex + side * eyeRX * 1.1, eyeY - eyeRY * 0.55);
  ctx.stroke();
  // brow
  ctx.strokeStyle = HAIR_DEEP;
  ctx.lineWidth = headR * 0.045;
  ctx.beginPath();
  ctx.moveTo(ex - side * eyeRX * 0.9, eyeY - eyeRY * 1.75);
  ctx.quadraticCurveTo(ex, eyeY - eyeRY * 2.0, ex + side * eyeRX * 0.95, eyeY - eyeRY * 1.6);
  ctx.stroke();
}

// Nose dot + mouth
ctx.fillStyle = SKIN_SHADE;
ctx.beginPath();
ctx.ellipse(cx, headCY + headR * 0.62, headR * 0.035, headR * 0.05, 0, 0, Math.PI * 2);
ctx.fill();
ctx.strokeStyle = "#B97A6B";
ctx.lineWidth = headR * 0.035;
ctx.beginPath();
if (SMILE) {
  ctx.arc(cx, headCY + headR * 0.78, headR * 0.14, 0.15 * Math.PI, 0.85 * Math.PI);
} else {
  ctx.moveTo(cx - headR * 0.07, headCY + headR * 0.86);
  ctx.quadraticCurveTo(cx, headCY + headR * 0.91, cx + headR * 0.07, headCY + headR * 0.86);
}
ctx.stroke();

// Blush
ctx.globalAlpha = 0.35;
for (const side of [-1, 1]) {
  ctx.fillStyle = "#F7B8A8";
  ctx.beginPath();
  ctx.ellipse(cx + side * headR * 0.62, headCY + headR * 0.62, headR * 0.14, headR * 0.08, side * 0.2, 0, Math.PI * 2);
  ctx.fill();
}
ctx.globalAlpha = 1;

// Ahoge
ctx.strokeStyle = HAIR;
ctx.lineWidth = headR * 0.09;
ctx.lineCap = "round";
ctx.beginPath();
ctx.moveTo(cx + headR * 0.05, headCY - headR * 1.05);
ctx.bezierCurveTo(cx + headR * 0.1, headCY - headR * 1.5, cx - headR * 0.25, headCY - headR * 1.55, cx - headR * 0.3, headCY - headR * 1.15);
ctx.stroke();

document.title = `anime-done:${W}x${H}`;
