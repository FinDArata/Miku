// The overlay's two preferences: whether lines are romanised, and whether the
// words as written are shown under a romanised one.
//
// They live in the app's settings (settings.json, Settings → General) rather
// than in this window's own storage, so Settings can change them and the
// overlay picks the change up from the `settings-changed` event every window
// already listens to.

import type { LyricsPrefs } from "../core/bridge";

export const DEFAULT_PREFS: LyricsPrefs = {
  romanize: true,
  placement: "island",
  showOriginal: true,
  opacity: 0.25,
  fontSize: 16,
  textColor: "#ffffff",
  background: "#08090c",
};

/** The preferences as the settings window stores them; missing reads as on.
 *  The look's four values are carried over when the caller knows them. */
export function prefsFrom(
  settings: { lyricsRomanize?: boolean; lyricsShowOriginal?: boolean } | null,
): LyricsPrefs {
  return {
    ...DEFAULT_PREFS,
    romanize: settings?.lyricsRomanize !== false,
    showOriginal: settings?.lyricsShowOriginal !== false,
  };
}

/** How long a pause keeps the card up, in ms: a skip back is not a stop. */
export const HIDE_AFTER_PAUSE_MS = 10_000;

/**
 * What the card does on its own, from what the player says. `"show"` for a song
 * that just started, `"hide"` when nothing is loaded at all, `"wait"` for a
 * pause (the card stays a moment, then hides), and `"stay"` when nothing about
 * the state asks for a change.
 *
 * `up` is whether the card is on screen, and `waiting` whether a pause's grace
 * period is already counting.
 */
export function autoAction(o: {
  enabled: boolean;
  up: boolean;
  waiting: boolean;
  playing: boolean;
  /** A real song: not an advertisement, not an empty session. */
  hasSong: boolean;
}): "show" | "hide" | "wait" | "stay" {
  if (!o.enabled) return "stay";
  if (o.playing && o.hasSong) return o.up ? "stay" : "show";
  // Nothing loaded at all: no reason to wait.
  if (!o.hasSong) return o.up ? "hide" : "stay";
  // Paused with a song loaded: the grace period, once.
  if (!o.up || o.waiting) return "stay";
  return "wait";
}
