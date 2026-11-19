// What Miku shows off in each main-menu bubble: one big prop per page (a
// house, a dress on its hanger, a mic…), drawn in a 100 × 100 box in front of
// her. At bubble size her arms are too small to tell the pages apart; the prop
// and her face do it.

type Ctx = CanvasRenderingContext2D;

export type PropName = "house" | "dress" | "mic" | "notepad" | "book" | "palette" | "gear" | "leek" | "letter";

const TEAL = "#39C5BB";
const TEAL_DEEP = "#1F8C86";
const PINK = "#E12885";
const PAPER = "#F5F8FA";
const STEEL = "#8E97A3";
const INK = "#2B3440";

function path(x: Ctx, d: string, fill: string | null, stroke: string | null = null, width = 4) {
  const p = new Path2D(d);
  if (fill) {
    x.fillStyle = fill;
    x.fill(p);
  }
  if (stroke) {
    x.strokeStyle = stroke;
    x.lineWidth = width;
    x.lineCap = "round";
    x.lineJoin = "round";
    x.stroke(p);
  }
}

function dot(x: Ctx, cx: number, cy: number, r: number, fill: string) {
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.fillStyle = fill;
  x.fill();
}

const PROPS: Record<PropName, (x: Ctx) => void> = {
  house(x) {
    path(x, "M22 48 H78 V88 H22 Z", PAPER, INK, 3);
    path(x, "M12 52 L50 16 L88 52 Z", PINK, INK, 3);
    path(x, "M42 88 V66 Q50 60 58 66 V88 Z", TEAL, INK, 3);
    path(x, "M64 30 V18 H74 V39", null, INK, 3);
  },
  dress(x) {
    path(x, "M50 8 Q58 8 58 15 Q58 20 50 24", null, STEEL, 4);
    path(x, "M50 24 L18 40 H82 Z", null, STEEL, 4);
    path(x, "M36 36 Q50 46 64 36 L66 52 L84 92 H16 L34 52 Z", PINK, INK, 3);
    path(x, "M34 52 H66", null, PAPER, 4);
    dot(x, 50, 70, 4, PAPER);
  },
  mic(x) {
    // A stage mic: dark grille, a teal ring, a pink handle — not a magnifier.
    path(x, "M42 50 H58 L55 96 H45 Z", PINK, INK, 3);
    dot(x, 50, 30, 23, "#46505C");
    x.save();
    x.beginPath();
    x.arc(50, 30, 23, 0, Math.PI * 2);
    x.clip();
    for (let i = 10; i < 52; i += 7) path(x, `M${20 + i} 4 V56 M24 ${i - 2} H76`, null, "#A9B4C0", 2);
    x.restore();
    path(x, "M36 50 H64", null, TEAL, 7);
    x.beginPath();
    x.arc(50, 30, 23, 0, Math.PI * 2);
    x.strokeStyle = INK;
    x.lineWidth = 3;
    x.stroke();
  },
  notepad(x) {
    path(x, "M18 14 H70 V90 H18 Z", "#FFF6D6", INK, 3);
    for (let y = 34; y <= 78; y += 11) path(x, `M26 ${y} H62`, null, "#C9B98A", 2.5);
    path(x, "M18 14 H70 V24 H18 Z", TEAL, INK, 3);
    path(x, "M88 30 L56 82 L50 92 L60 86 L92 34 Z", PINK, INK, 3);
    path(x, "M50 92 L56 82 L60 86 Z", INK, null);
  },
  book(x) {
    path(x, "M8 30 Q30 20 50 32 Q70 20 92 30 V84 Q70 74 50 86 Q30 74 8 84 Z", TEAL_DEEP, INK, 3);
    path(x, "M12 28 Q30 18 50 30 V80 Q30 68 12 78 Z", PAPER, INK, 2.5);
    path(x, "M88 28 Q70 18 50 30 V80 Q70 68 88 78 Z", PAPER, INK, 2.5);
    for (const y of [40, 50, 60]) {
      path(x, `M20 ${y - 4} Q30 ${y - 9} 42 ${y - 2}`, null, "#9AA6B2", 2.5);
      path(x, `M58 ${y - 2} Q70 ${y - 9} 80 ${y - 4}`, null, "#9AA6B2", 2.5);
    }
  },
  palette(x) {
    path(x, "M50 14 C82 14 96 36 90 56 C86 70 70 64 66 74 C62 86 50 92 36 88 C14 82 6 62 10 44 C14 26 30 14 50 14 Z", "#F1DDB8", INK, 3);
    dot(x, 64, 76, 6, "#0B0F11");
    dot(x, 30, 36, 7, PINK);
    dot(x, 50, 28, 7, TEAL);
    dot(x, 70, 34, 7, "#FFD36B");
    dot(x, 26, 58, 7, "#8FA3FF");
    path(x, "M96 8 L58 58", null, "#B07A48", 6);
    path(x, "M62 52 L54 64 L50 70 L58 66 L66 56 Z", INK, null);
  },
  gear(x) {
    const teeth: string[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const p = (r: number, da: number) => `${50 + Math.cos(a + da) * r} ${50 + Math.sin(a + da) * r}`;
      teeth.push(`${i ? "L" : "M"}${p(30, -0.32)} L${p(42, -0.2)} L${p(42, 0.2)} L${p(30, 0.32)}`);
    }
    path(x, `${teeth.join(" ")} Z`, "#B9C2CC", INK, 3);
    dot(x, 50, 50, 14, TEAL);
    x.beginPath();
    x.arc(50, 50, 14, 0, Math.PI * 2);
    x.strokeStyle = INK;
    x.lineWidth = 3;
    x.stroke();
    dot(x, 50, 50, 5, INK);
  },
  leek(x) {
    path(x, "M30 94 L58 40", null, INK, 19);
    path(x, "M30 94 L58 40", null, "#F4F7E8", 14);
    path(x, "M56 44 L62 6 M58 42 L84 14 M60 44 L92 36", null, "#6BBF4A", 12);
    path(x, "M26 88 L22 96 M30 90 L30 98 M34 88 L38 96", null, "#D9D2B0", 2.5);
  },
  letter(x) {
    path(x, "M10 28 H90 V82 H10 Z", PAPER, INK, 3);
    path(x, "M10 28 L50 60 L90 28", null, INK, 3);
    path(x, "M50 52 C44 44 34 50 40 58 L50 66 L60 58 C66 50 56 44 50 52 Z", PINK, null);
  },
};

/** Draws `name` in the 100 × 100 box at the origin of the current transform. */
export function drawProp(x: Ctx, name: PropName) {
  PROPS[name](x);
}
