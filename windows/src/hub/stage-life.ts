// The life of the stage's Miku (hub/character.ts), kept out of the DOM so it
// can be tested: what she says, what she does while nothing is happening, and
// what a change of state makes her do. Nothing here touches a canvas — the
// caller hands the answers to a BotEngine.
//
// The rule everywhere: a gimmick is a mood, not a loop. She sleeps, stirs,
// looks around, and dozes off again; the bubble follows her, the emotes are the
// ones the island uses, and everything is timed from an injected `rng` so the
// choices are reproducible in a test.

import type { BotEmoteName } from "../core/layout";
import { N_ } from "../i18n/i18n";
import type { MikuVariantId } from "../mochi/variants";

// ── The stage's state ─────────────────────────────────────────────────────────

/**
 * What the character is up to. Live here rather than in hub/character.ts so the
 * rules can be tested without a DOM: that module is the drawing, this is the
 * meaning.
 */
export type StageState = "waiting-permission" | "running" | "clear" | "idle";

export const STAGE_STATES: StageState[] = ["waiting-permission", "running", "clear", "idle"];

// ── What she says ─────────────────────────────────────────────────────────────

/**
 * The lines her bubble can hold, per state. The first is the one she wears when
 * the stage is built; the rest take turns while the state lasts, so a stage
 * left alone on "running" does not read the same sentence for an hour.
 *
 * Kept as English keys through N_() — hub/stage-life.ts is scanned for them the
 * same way as a t() call — and translated where they are drawn.
 */
export const BUBBLES: Record<StageState, readonly string[]> = {
  "waiting-permission": [
    N_("Permission first, please!"),
    N_("Yes or no?"),
  ],
  running: [
    N_("Focus mode…"),
    N_("Working on it!"),
  ],
  clear: [
    N_("All done — time to dance!"),
    N_("Ta-da!"),
  ],
  idle: [
    N_("Zzz… call me when you need me"),
    N_("Mmh… I'm up!"),
    N_("Did you call me?"),
  ],
};

/** A click on her, and a double click. */
export const CLICK_BUBBLE = N_("Hey, that tickles!");
export const DOUBLE_CLICK_BUBBLE = N_("Aww, thanks!");

/** While music plays and she dances. */
export const MUSIC_BUBBLE = N_("Dancing along!");

/** The line a freshly built stage shows. */
export function firstBubble(state: StageState): string {
  return BUBBLES[state][0];
}

/** The next line from the same state, never the one already showing. */
export function nextBubble(state: StageState, current: string, rng: () => number): string {
  const lines = BUBBLES[state];
  const others = lines.filter((line) => line !== current);
  if (others.length === 0) return lines[0];
  return others[Math.min(others.length - 1, Math.floor(rng() * others.length))];
}

// ── Time ──────────────────────────────────────────────────────────────────────

/** 0…1 from an injected random. */
function unit(rng: () => number): number {
  return Math.min(1, Math.max(0, rng()));
}

/** A whole number of milliseconds between two bounds. */
function between(rng: () => number, range: readonly [number, number]): number {
  return Math.round(range[0] + (range[1] - range[0]) * unit(rng));
}

/** How long she sleeps before stirring, and how long she stays up. */
export const DOZE_MS: readonly [number, number] = [26_000, 48_000];
export const AWAKE_MS: readonly [number, number] = [9_000, 15_000];
/** How often the bubble changes while the state holds. */
export const BUBBLE_EVERY_MS: readonly [number, number] = [9_000, 15_000];

export const nextDoze = (rng: () => number) => between(rng, DOZE_MS);
export const nextAwake = (rng: () => number) => between(rng, AWAKE_MS);
export const nextBubbleAt = (rng: () => number) => between(rng, BUBBLE_EVERY_MS);

// ── What she does when nothing happens ────────────────────────────────────────

/**
 * The emotes she runs through after waking up: a glance, a wink, a proud little
 * nod, and (rarely) a yawn before she dozes off again. `lookDrift` is the
 * island's favourite antic but is left out here — on the stage the pointer owns
 * her gaze every frame, so a drift would be overwritten before it is seen.
 */
export const AWAKE_ANTICS = ["wink", "proud", "happy", "yawn"] as const;

/**
 * One emote for a moment of being awake. Weighted, like the island's: a wink is
 * the ordinary case, the yawn the one that ends the spell.
 */
export function awakeAntic(rng: () => number): BotEmoteName {
  const r = unit(rng);
  if (r < 0.36) return "wink";
  if (r < 0.68) return "proud";
  if (r < 0.9) return "happy";
  return "yawn";
}

// ── What a change of state makes her do ───────────────────────────────────────

/** One off burst: an emote, a puff of particles, or both. */
export interface Burst {
  emote: BotEmoteName | null;
  particle: "star" | "heart" | "sweat" | "spark" | null;
  count: number;
}

/**
 * The reaction to the stage moving from `from` to `to`, or null when nothing
 * should happen. Deliberately quiet on the way into "running" (a blink, a spark:
 * she is concentrating) and loud on "clear" (stars, a proud pose).
 */
export function burstFor(from: StageState, to: StageState): Burst | null {
  if (from === to) return null;
  switch (to) {
    case "clear":
      return { emote: "proud", particle: "star", count: 6 };
    case "waiting-permission":
      return { emote: "surprised", particle: "sweat", count: 1 };
    case "running":
      return { emote: "happy", particle: "spark", count: 2 };
    case "idle":
      return { emote: "yawn", particle: null, count: 0 };
  }
}

// ── The weather ───────────────────────────────────────────────────────────────

/** Which confetti drifts around her, by the Miku on stage. */
export type Weather = "snow" | "petal" | "sparkle";

/**
 * Snow Miku brings snow, Sakura Miku petals, the classic one the stage's own
 * teal sparks. Asked every frame by the weather canvas, so it follows a variant
 * picked in the wardrobe without the page being rebuilt.
 */
export function weatherFor(variant: MikuVariantId): Weather {
  switch (variant) {
    case "snow": return "snow";
    case "sakura": return "petal";
    default: return "sparkle";
  }
}
