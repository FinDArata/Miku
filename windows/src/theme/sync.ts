// Keeps the window's skin in step with the wardrobe.
//
// One call per window — `watchSkin()` — paints the stored skin at once, then
// repaints whenever the wardrobe saves a new one (the `settings-changed` event
// Rust broadcasts), and while a swatch is only hovered (the `skin-preview`
// event the island sends). Both are plain data: no window draws a skin from
// another window's state.

import { State, type Settings } from "../core/state";
import { onEvent } from "../core/bridge";
import { parseVariant, resolveVariant, type VariantSelection } from "../mochi/wardrobe";
import { applySkin, cachedSkin, type SkinTheme } from "./skins";
import { themeFor } from "./skins";

/** The variant a selection means today ("auto" follows the season). */
export function skinOf(selection: VariantSelection, now = new Date()) {
  return themeFor(resolveVariant(selection, now));
}

/** The skin the saved settings ask for, right now. */
export function storedSkin(): SkinTheme {
  return skinOf(parseVariant(State.settings.mikuVariant));
}

/**
 * Paints the stored skin and follows it: a new one saved from any window, and
 * the ones only hovered in the wardrobe. Returns the unsubscribe.
 */
export function watchSkin(): () => void {
  // The last run's skin first, so the window opens in its own colour rather
  // than flashing the default until the settings arrive.
  const remembered = cachedSkin();
  if (remembered) applySkin(remembered);
  applySkin(storedSkin().id);

  const offSettings = onEvent<Settings>("settings-changed", (s) => {
    State.settings = { ...State.settings, ...s };
    applySkin(storedSkin().id);
  });
  // A hovered swatch: the wardrobe says which Miku would be drawn; null ends it.
  const offPreview = onEvent<string | null>("skin-preview", (variant) => {
    if (!variant) {
      applySkin(storedSkin().id);
      return;
    }
    // Not remembered: a hover is not a choice.
    applySkin(skinOf(parseVariant(variant)).id, undefined, false);
  });

  return () => {
    void offSettings.then((off) => off());
    void offPreview.then((off) => off());
  };
}
