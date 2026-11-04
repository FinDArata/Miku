// The overlay's two preferences: whether lines are romanised, and whether the
// words as written are shown under a romanised one.
//
// They live in the app's settings (settings.json, Settings → General) rather
// than in this window's own storage, so Settings can change them and the
// overlay picks the change up from the `settings-changed` event every window
// already listens to.

import type { LyricsPrefs } from "../core/bridge";

export const DEFAULT_PREFS: LyricsPrefs = { romanize: true, showOriginal: true };

/** The preferences as the settings window stores them; missing reads as on. */
export function prefsFrom(settings: { lyricsRomanize?: boolean; lyricsShowOriginal?: boolean } | null): LyricsPrefs {
  return {
    romanize: settings?.lyricsRomanize !== false,
    showOriginal: settings?.lyricsShowOriginal !== false,
  };
}
