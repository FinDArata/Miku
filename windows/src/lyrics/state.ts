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
 * period is already counting. `hasTrack` is whether the player reports anything
 * at all; `hasSong` whether it is a song rather than a video or an advert.
 */
export function autoAction(o: {
  enabled: boolean;
  up: boolean;
  waiting: boolean;
  playing: boolean;
  /** Anything at all is loaded: a song, a video, an advert. */
  hasTrack?: boolean;
  /** A real song: not an advertisement, not a video, not an empty session. */
  hasSong: boolean;
}): "show" | "hide" | "wait" | "stay" {
  if (!o.enabled) return "stay";
  if (o.playing && o.hasSong) return o.up ? "stay" : "show";
  // Nothing loaded at all: no reason to wait. A card nobody asked for goes now.
  const hasTrack = o.hasTrack ?? o.hasSong;
  if (!hasTrack) return o.up ? "hide" : "stay";
  // Something that is not a song — a YouTube video, a Short, an advert. It has
  // no words, so it may not open a card, but it may not close one either: the
  // card the user detached is theirs, and putting on a video must not take it
  // away. Only a stop, or a pause running out its grace, closes it.
  if (!o.hasSong) return "stay";
  // Paused with a song loaded: the grace period, once.
  if (!o.up || o.waiting) return "stay";
  return "wait";
}

/**
 * How long the top pill keeps its words while something other than the song owns
 * the one media session a browser publishes, in ms. This covers a glance at
 * another tab; past it the user is watching that video, and the lyrics have no
 * business still being on screen.
 */
export const HOLD_MAX_MS = 20_000;

/**
 * Whether the top pill still shows the words it holds, given how long another
 * thing has owned the session. `since` is when that takeover began (null when
 * the song owns it). Pure, so the rule is tested rather than argued about.
 */
export function holdStillUp(since: number | null, now: number): boolean {
  if (since == null) return false;
  const elapsed = now - since;
  // A clock that went backwards (a suspend, a time change) must not pin it up.
  return elapsed >= 0 && elapsed < HOLD_MAX_MS;
}
