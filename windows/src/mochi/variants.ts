// The three Miku variants: the colours and the handful of shapes that differ
// between them. Everything else in engine.ts is shared, so a variant is a
// palette plus, at most, an `extra` painter for what only it wears.
//
// Classic, Snow and Sakura are all official Miku designs, covered by one
// Piapro Character License (see LICENSE-ASSETS.md). The chibi drawn here is an
// original work, not official artwork.
//
// Coordinates are the engine's 0..300 prototype space, the character centred on
// (150, ~150) — the same space engine.ts draws the body and the head in.

import type { RGB } from "./engine";

export type MikuVariantId = "classic" | "snow" | "sakura";

/** Every variant, in the order the wardrobe lists them. */
export const MIKU_VARIANT_IDS: readonly MikuVariantId[] = ["classic", "snow", "sakura"];

export const DEFAULT_VARIANT: MikuVariantId = "classic";

/** What a variant paints on top of the shared body (see `extra`). */
export interface VariantExtras {
  /** Back layer, behind the body: tails, sakura petals behind the head. */
  behind?: (x: CanvasRenderingContext2D, v: MikuVariant, t: number) => void;
  /** Front layer, over the face: hair ornaments, headset mic, snowflakes. */
  front?: (x: CanvasRenderingContext2D, v: MikuVariant, t: number) => void;
}

export interface MikuVariant {
  id: MikuVariantId;
  /** Its name, as the wardrobe shows it. English; the UI translates it. */
  label: string;

  // Hair
  hair: RGB;
  hairDark: RGB;
  /** The highlight streak drawn on the bangs, as a CSS rgba string. */
  hairHi: string;

  // Eyes: a gradient, light at the top to dark at the bottom.
  eye1: RGB;
  eye2: RGB;
  eyeInk: string;

  // Skin, shared by all three but kept here so a variant could tint it.
  skin: RGB;

  // Outfit
  tie: RGB;
  shirt: RGB;
  skirt: RGB;
  skirtShade: RGB;
  /** The white/grey trim: sleeves, collar, skirt hem. */
  trim: RGB;
  gloves: RGB;
  headset: RGB;
  /** The "01" on the left sleeve. */
  armband: RGB;

  /** A fur collar over the neckline (Snow's winter outfit). */
  furCollar?: boolean;

  /** Paint the parts only this variant has. */
  extra?: VariantExtras;
}

// ── Palettes ──────────────────────────────────────────────────────────────────

const SKIN: RGB = [1, 0.914, 0.863]; // #FFE9DC
const WHITE: RGB = [0.98, 0.98, 0.99];

/** Hatsune Miku (classic): teal twin-tails, grey skirt, teal tie. */
const CLASSIC: MikuVariant = {
  id: "classic",
  label: "Miku",
  hair: [0.224, 0.773, 0.733],     // #39C5BB
  hairDark: [0.141, 0.588, 0.565], // #249690
  hairHi: "rgba(126,232,224,0.62)",
  eye1: [0.337, 0.851, 0.812],     // #56D9CF
  eye2: [0.043, 0.463, 0.459],     // #0B7675
  eyeInk: "rgb(20,44,46)",
  skin: SKIN,
  tie: [0.224, 0.773, 0.733],
  shirt: WHITE,
  skirt: [0.376, 0.408, 0.451],    // #606774
  skirtShade: [0.286, 0.318, 0.361],
  trim: [0.878, 0.898, 0.925],
  gloves: [0.169, 0.184, 0.212],   // the black forearm sleeves
  headset: [0.243, 0.259, 0.290],
  armband: [0.169, 0.184, 0.212],
};

/** Snow Miku: pale blue-white hair, a fur-trimmed white and blue winter outfit. */
const SNOW: MikuVariant = {
  id: "snow",
  label: "Snow Miku",
  hair: [0.894, 0.933, 0.976],     // #E4EEF9
  hairDark: [0.678, 0.769, 0.886], // #ADC4E2
  hairHi: "rgba(255,255,255,0.78)",
  eye1: [0.478, 0.796, 0.949],     // #7ACBF2
  eye2: [0.129, 0.408, 0.643],     // #2168A4
  eyeInk: "rgb(26,46,70)",
  skin: SKIN,
  tie: [0.404, 0.678, 0.886],      // #67ADE2
  shirt: WHITE,
  skirt: [0.541, 0.698, 0.851],    // #8AB2D9
  skirtShade: [0.427, 0.588, 0.749],
  trim: [0.945, 0.969, 0.992],
  gloves: [0.847, 0.902, 0.961],   // white gloves, not black sleeves
  headset: [0.867, 0.914, 0.969],
  armband: [0.404, 0.678, 0.886],
  furCollar: true,
  extra: {
    // A soft snowflake ring behind the head, and the fur collar on the neckline.
    behind: (x, _v, t) => {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + t * 0.25;
        snowflake(x, 150 + Math.cos(a) * 108, 56 + Math.sin(a) * 100, 7, "rgba(255,255,255,0.4)");
      }
    },
    front: (x, _v, t) => {
      // Two snowflakes in the hair, slowly turning.
      snowflake(x, 104, 34, 9, "rgba(255,255,255,0.92)", t * 0.6);
      snowflake(x, 196, 30, 7, "rgba(255,255,255,0.85)", -t * 0.5);
    },
  },
};

/** Sakura Miku: pink hair, white and pink outfit, cherry-blossom ornaments. */
const SAKURA: MikuVariant = {
  id: "sakura",
  label: "Sakura Miku",
  hair: [0.961, 0.659, 0.780],     // #F5A8C7
  hairDark: [0.886, 0.498, 0.647], // #E27FA5
  hairHi: "rgba(255,214,232,0.75)",
  eye1: [0.969, 0.616, 0.737],     // #F79DBC
  eye2: [0.678, 0.239, 0.404],     // #AD3D67
  eyeInk: "rgb(58,24,38)",
  skin: SKIN,
  tie: [0.937, 0.478, 0.655],      // #EF7AA7
  shirt: WHITE,
  skirt: [0.945, 0.804, 0.851],    // #F1CDD9
  skirtShade: [0.886, 0.686, 0.757],
  trim: [1, 1, 1],
  gloves: [1, 0.949, 0.965],
  headset: [1, 0.925, 0.949],
  armband: [0.937, 0.478, 0.655],
  extra: {
    front: (x, _v, t) => {
      // Cherry blossoms tucked by the ears, and petals drifting down.
      blossom(x, 100, 40, 11, t * 0.4);
      blossom(x, 202, 36, 9, -t * 0.35);
      for (let i = 0; i < 4; i++) {
        const k = ((t * 0.16 + i * 0.25) % 1);
        const px = 84 + i * 44 + Math.sin(t * 1.1 + i) * 6;
        const py = 150 + k * 130;
        x.save();
        x.globalAlpha = 0.55 * (1 - k);
        x.translate(px, py);
        x.rotate(t * 0.9 + i);
        petal(x, 5.5);
        x.restore();
      }
    },
  },
};

export const MIKU_VARIANTS: Record<MikuVariantId, MikuVariant> = {
  classic: CLASSIC,
  snow: SNOW,
  sakura: SAKURA,
};

// ── Small ornaments ───────────────────────────────────────────────────────────

/** A six-armed snowflake. */
function snowflake(
  x: CanvasRenderingContext2D,
  px: number, py: number, r: number, col: string, rot = 0,
) {
  x.save();
  x.translate(px, py);
  x.rotate(rot);
  x.strokeStyle = col;
  x.lineWidth = Math.max(1, r * 0.2);
  x.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    x.beginPath();
    x.moveTo(0, 0);
    x.lineTo(dx * r, dy * r);
    // A little barb on each arm.
    x.moveTo(dx * r * 0.6, dy * r * 0.6);
    x.lineTo(dx * r * 0.6 + dy * r * 0.34, dy * r * 0.6 - dx * r * 0.34);
    x.moveTo(dx * r * 0.6, dy * r * 0.6);
    x.lineTo(dx * r * 0.6 - dy * r * 0.34, dy * r * 0.6 + dx * r * 0.34);
    x.stroke();
  }
  x.restore();
}

/** One five-petal cherry blossom. */
function blossom(
  x: CanvasRenderingContext2D,
  px: number, py: number, r: number, rot = 0,
) {
  x.save();
  x.translate(px, py);
  x.rotate(rot);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    x.save();
    x.rotate(a);
    x.fillStyle = i % 2 ? "rgba(255,214,232,0.96)" : "rgba(249,183,208,0.96)";
    x.beginPath();
    x.ellipse(0, -r * 0.62, r * 0.42, r * 0.62, 0, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }
  x.fillStyle = "rgba(255,238,168,0.98)";
  x.beginPath();
  x.arc(0, 0, r * 0.2, 0, Math.PI * 2);
  x.fill();
  x.restore();
}

/** A single falling petal. */
function petal(x: CanvasRenderingContext2D, r: number) {
  x.fillStyle = "rgba(249,183,208,0.9)";
  x.beginPath();
  x.moveTo(0, -r);
  x.quadraticCurveTo(r * 0.9, -r * 0.2, 0, r);
  x.quadraticCurveTo(-r * 0.9, -r * 0.2, 0, -r);
  x.fill();
}

// ── Choosing one ──────────────────────────────────────────────────────────────

const IDS: ReadonlySet<string> = new Set(MIKU_VARIANT_IDS);

export function isMikuVariant(v: unknown): v is MikuVariantId {
  return typeof v === "string" && IDS.has(v);
}

/**
 * The variant a date dresses Miku in when the wardrobe is on "auto": Snow from
 * December to February, Sakura through March and April, classic the rest of the
 * year. Read in the user's local calendar.
 */
export function seasonalVariant(date: Date): MikuVariantId {
  const month = date.getMonth() + 1; // 1–12
  if (month === 12 || month <= 2) return "snow";
  if (month === 3 || month === 4) return "sakura";
  return "classic";
}
