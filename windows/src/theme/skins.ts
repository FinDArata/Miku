// The skins of the app: the wardrobe's three Miku, as whole-interface themes.
//
// The wardrobe already picks which Miku is drawn (mochi/variants.ts). This
// module turns that same choice into the colours of the hub, the pill and the
// small accents of the island, so picking Snow Miku in the wardrobe paints the
// window winter-blue instead of only her hair.
//
// Every non-accent colour is derived from the accent, so a new variant needs
// its palette entry and nothing else.

import { MIKU_VARIANTS, type MikuVariantId } from "../mochi/variants";

/** What one skin paints: the accent, its shades, the surfaces and the text. */
export interface SkinTheme {
  id: MikuVariantId;
  /** The skin's name, translated by the UI (`VARIANT_KEYS` in mochi/wardrobe.ts). */
  label: string;

  /** The accent, mixed from the variant's own palette (tie and hair). */
  accent: string;
  /** Lighter, for hovers and the tip of the active nav bar. */
  accentBright: string;
  /** Darker, for borders and pressed states. */
  accentDeep: string;
  /** The accent at 12% — the tint of hovered rows and active pills. */
  accentSoft: string;
  /** The accent at 34% — hairlines and focus rings. */
  accentLine: string;
  /** Text on a filled accent button: near-black, tinted with the accent. */
  onAccent: string;

  /** The window's own black, leaning toward the accent's hue. */
  panel: string;
  /** Cards and fields, a step lighter each. */
  card: string;
  field: string;
  /** The hairline between surfaces. */
  line: string;

  /** Text tiers. */
  text: string;
  body: string;
  secondary: string;
  muted: string;

  /** The darkest black of the hero band, under its colour. */
  heroBase: string;
}

/** "#39c5bb" → [57, 197, 187]. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix `hex` toward `to` (0 = hex, 1 = to). */
function mix(hex: string, to: [number, number, number], amount: number): string {
  const [r, g, b] = rgb(hex);
  const at = (a: number, c: number) => Math.round(a + (c - a) * amount);
  return `#${[at(r, to[0]), at(g, to[1]), at(b, to[2])]
    .map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0"))
    .join("")}`;
}

const BLACK: [number, number, number] = [4, 8, 10];
const WHITE: [number, number, number] = [250, 255, 255];

/** "r,g,b" of a hex, for the rgba() tints. */
function channels(hex: string): string {
  return rgb(hex).join(",");
}

function tint(hex: string, alpha: number): string {
  return `rgba(${channels(hex)},${alpha})`;
}

/**
 * A theme from an accent alone: the surfaces lean the accent's way by a few
 * percent, the text leans the other way, the hero band is nearly black.
 */
function themeFrom(
  id: MikuVariantId,
  label: string,
  accent: string,
  /** How far the surfaces lean into the accent's hue (0…1). */
  lean: number,
): SkinTheme {
  // The surfaces stay nearly black: the accent only tints them, it never
  // becomes the background. `lean` nudges that by a few percent either way.
  const toward = (base: number) => base - lean * 0.025;
  return {
    id,
    label,
    accent,
    accentBright: mix(accent, WHITE, 0.42),
    accentDeep: mix(accent, BLACK, 0.42),
    accentSoft: tint(accent, 0.12),
    accentLine: tint(accent, 0.34),
    onAccent: mix(accent, BLACK, 0.88),
    panel: mix(accent, BLACK, toward(0.962)),
    card: mix(accent, BLACK, toward(0.925)),
    field: mix(accent, BLACK, toward(0.885)),
    line: tint(mix(accent, WHITE, 0.62), 0.1),
    text: mix(accent, WHITE, 0.94),
    body: mix(accent, WHITE, 0.84),
    secondary: mix(accent, WHITE, 0.55),
    muted: mix(accent, WHITE, 0.33),
    heroBase: mix(accent, [0, 2, 4], 0.985),
  };
}

/** "r,g,b" of a variant's palette colour, as a hex. */
function variantHex(rgbValues: readonly number[]): string {
  return `#${rgbValues.map((c) => Math.max(0, Math.min(255, Math.round(c * 255))).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The three skins. The accent of each is that Miku's tie — the one colour she
 * wears head to toe — so the window and the character can never disagree about
 * which skin is on.
 */
export const SKIN_THEMES: Record<MikuVariantId, SkinTheme> = {
  classic: themeFrom("classic", "Miku", variantHex(MIKU_VARIANTS.classic.tie), 0.35),
  snow: themeFrom("snow", "Snow Miku", variantHex(MIKU_VARIANTS.snow.tie), 0.3),
  sakura: themeFrom("sakura", "Sakura Miku", variantHex(MIKU_VARIANTS.sakura.tie), 0.3),
};

export const SKIN_IDS: readonly MikuVariantId[] = ["classic", "snow", "sakura"];

export function themeFor(variant: MikuVariantId): SkinTheme {
  return SKIN_THEMES[variant] ?? SKIN_THEMES.classic;
}

/** The CSS custom properties one skin sets, by name. */
export function skinProperties(theme: SkinTheme): Record<string, string> {
  return {
    "--skin-accent": theme.accent,
    "--skin-accent-bright": theme.accentBright,
    "--skin-accent-deep": theme.accentDeep,
    "--skin-accent-soft": theme.accentSoft,
    "--skin-accent-line": theme.accentLine,
    "--skin-on-accent": theme.onAccent,
    "--skin-panel": theme.panel,
    "--skin-card": theme.card,
    "--skin-field": theme.field,
    "--skin-line": theme.line,
    "--skin-text": theme.text,
    "--skin-body": theme.body,
    "--skin-secondary": theme.secondary,
    "--skin-muted": theme.muted,
    "--skin-hero-base": theme.heroBase,
    // The accent as channels, so any alpha works in CSS:
    // `rgba(var(--skin-accent-rgb), 0.09)`. Written here because a plain CSS
    // variable cannot be split into channels on its own.
    "--skin-accent-rgb": channels(theme.accent),
    "--skin-accent-bright-rgb": channels(theme.accentBright),
  };
}

/** Where the last skin applied is remembered, so the first paint is already right. */
export const SKIN_CACHE_KEY = "miku.skin";

/** The skin on screen right now, as the theme code last applied it. */
let current: MikuVariantId = "classic";

export function currentSkin(): MikuVariantId {
  return current;
}

interface StyleSink {
  setProperty(name: string, value: string): void;
}

/**
 * Paints `variant` over the window: every `--skin-*` property on the document's
 * root, which hub.css, pill.css and style.css read. Cheap enough to call on
 * every change, and safe to call before the first render.
 */
export function applySkin(
  variant: MikuVariantId,
  /** Where to write; the document's root by default. */
  style: StyleSink | null = typeof document === "undefined"
    ? null
    : document.documentElement?.style ?? null,
  /**
   * Remember it for the next launch. False while a skin is only being tried on
   * in the wardrobe: a hover must not decide what the window opens as.
   */
  remember = true,
): void {
  const theme = themeFor(variant);
  current = theme.id;
  if (!style) return;
  for (const [name, value] of Object.entries(skinProperties(theme))) style.setProperty(name, value);
  if (!remember) return;
  // Remembered for the next launch: the theme is painted before the settings
  // arrive, so the window never opens in the wrong colour and then changes.
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SKIN_CACHE_KEY, theme.id);
  } catch {
    // A webview with storage turned off keeps the theme in memory only.
  }
}

/** The skin remembered from the last run, for the first paint. */
export function cachedSkin(): MikuVariantId | null {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(SKIN_CACHE_KEY);
    return raw && raw in SKIN_THEMES ? (raw as MikuVariantId) : null;
  } catch {
    return null;
  }
}

/** The variant's own palette, for the code that draws Miku herself. */
export function variantPalette(variant: MikuVariantId) {
  return MIKU_VARIANTS[variant] ?? MIKU_VARIANTS.classic;
}
