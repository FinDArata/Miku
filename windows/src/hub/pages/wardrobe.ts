// Wardrobe, in the Miku window: who Miku is (classic, Snow, Sakura — or the
// season's) and what she wears. Clicking a skin paints the whole window with
// it, and hovering one tries it on without keeping it.
//
// The island's own wardrobe (views/wardrobe.ts) is drawn at 30 px for a notch;
// this page is the same choice at window size, with a preview card, so it is
// its own layout rather than a scaled copy.

import { h } from "../../views/dom";
import { t } from "../../i18n/i18n";
import { Bridge } from "../../core/bridge";
import { State } from "../../core/state";
import { MIKU_VARIANTS, seasonalVariant } from "../../mochi/variants";
import {
  OUTFIT_SELECTIONS, VARIANT_SELECTIONS, parseOutfit, parseVariant, resolveOutfit, resolveVariant,
  seasonalOutfit, OUTFIT_KEYS, VARIANT_KEYS,
} from "../../mochi/wardrobe";
import { SKIN_THEMES, applySkin, currentSkin, themeFor } from "../../theme/skins";
import { liveMochi } from "../hero";
import type { HubContext } from "../shell";

/** "r,g,b" of a palette colour. */
function rgb(c: readonly number[]): string {
  return `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
}

/** A big swatch of one Miku: her hair, eyes and outfit as three bands. */
function swatchFor(sel: (typeof VARIANT_SELECTIONS)[number]): HTMLElement {
  const sw = h("span", { class: "hub-skin-swatch" });
  if (sel === "auto") {
    const v = MIKU_VARIANTS[seasonalVariant(new Date())];
    sw.style.background = `linear-gradient(135deg, ${rgb(v.hair)} 0 45%, ${rgb(v.skirt)} 45% 75%, ${rgb(v.tie)} 75%)`;
    sw.append(h("i", { class: "auto", text: t("AUTO") }));
    return sw;
  }
  const v = MIKU_VARIANTS[sel];
  sw.style.background = `linear-gradient(135deg, ${rgb(v.hair)} 0 45%, ${rgb(v.skirt)} 45% 75%, ${rgb(v.tie)} 75%)`;
  return sw;
}

export async function wardrobePage(page: HTMLElement, ctx: HubContext) {
  page.append(ctx.hero(
    "wardrobe",
    t("Wardrobe"),
    t("Who Miku is, and what she wears. The skin paints this window too."),
  ));

  // The preview: Miku herself in the skin on screen, with its name.
  const previewCanvas = h("canvas", { class: "hub-skin-preview" });
  const previewName = h("div", { class: "hub-skin-name" });
  const previewNote = h("div", { class: "hub-note" });
  const preview = h("div", { class: "hub-skin-preview-card" }, previewCanvas, h("div", { class: "meta" }, previewName, previewNote));

  const drawPreview = () => {
    const theme = themeFor(currentSkin());
    preview.style.setProperty("--card-color", theme.accent);
    preview.style.setProperty("--card-tint", theme.accentSoft);
    previewName.textContent = t(theme.label);
    previewNote.textContent = t("The window, the pill and Miku all wear this skin.");
  };

  // ── The skins ──
  const skinRow = h("div", { class: "hub-skin-row" });
  const skinButtons = new Map<string, HTMLButtonElement>();

  /** Try a skin on every window, or put the saved one back. */
  const previewSkin = (sel: typeof VARIANT_SELECTIONS[number] | null) => {
    const saved = resolveVariant(parseVariant(State.settings.mikuVariant), new Date());
    const resolved = sel ? resolveVariant(sel, new Date()) : saved;
    // The preview is not remembered: a hover must not decide what the window
    // opens as next time. Only the click does.
    applySkin(resolved, undefined, false);
    // Miku herself follows the hover too, through the same preview slot the
    // island's wardrobe uses (hub/hero.ts reads it every frame).
    State.variantPreview = sel ? resolved : null;
    State.notify();
    void Bridge.emitSkinPreview(sel ? resolved : null);
    drawPreview();
  };

  /** Try an outfit on, or put the saved one back. */
  const previewOutfit = (sel: (typeof OUTFIT_SELECTIONS)[number] | null) => {
    State.wardrobePreview = sel ? resolveOutfit(sel, new Date()) : null;
    State.notify();
  };

  for (const sel of VARIANT_SELECTIONS) {
    const button = h("button", {
      class: "hub-skin",
      "aria-label": t(VARIANT_KEYS[sel]),
      onclick: () => {
        if (parseVariant(State.settings.mikuVariant) === sel) return;
        State.settings.mikuVariant = sel;
        State.variantPreview = null;
        void Bridge.saveSettings(State.settings);
        applySkin(resolveVariant(sel, new Date()));
        void Bridge.emitSkinPreview(null);
        sync();
      },
    }) as HTMLButtonElement;
    button.append(
      swatchFor(sel),
      h("span", { class: "label", text: t(VARIANT_KEYS[sel]) }),
      h("span", { class: "sub", text: sel === "auto" ? t("Follows the season") : SKIN_THEMES[sel].accent.toUpperCase() }),
    );
    button.addEventListener("pointerenter", () => previewSkin(sel));
    button.addEventListener("pointerleave", (e) => {
      // Leaving the row, not moving between its buttons.
      const row = (e.currentTarget as HTMLElement).parentElement;
      if (row && !row.contains(e.relatedTarget as Node | null)) previewSkin(null);
    });
    skinButtons.set(sel, button);
    skinRow.append(button);
  }

  // ── The outfits ──
  const outfitRow = h("div", { class: "hub-outfit-row" });
  const outfitButtons = new Map<string, HTMLButtonElement>();
  for (const sel of OUTFIT_SELECTIONS) {
    const button = h("button", {
      class: "hub-outfit",
      text: t(OUTFIT_KEYS[sel]),
      onclick: () => {
        if (parseOutfit(State.settings.mochiOutfit) === sel) return;
        State.settings.mochiOutfit = sel;
        State.wardrobePreview = null;
        void Bridge.saveSettings(State.settings);
        sync();
      },
    }) as HTMLButtonElement;
    button.addEventListener("pointerenter", () => previewOutfit(sel));
    button.addEventListener("pointerleave", (e) => {
      // Leaving the row, not moving between its buttons.
      const row = (e.currentTarget as HTMLElement).parentElement;
      if (row && !row.contains(e.relatedTarget as Node | null)) previewOutfit(null);
    });
    outfitButtons.set(sel, button);
    outfitRow.append(button);
  }

  function sync() {
    const saved = parseVariant(State.settings.mikuVariant);
    for (const [sel, button] of skinButtons) button.classList.toggle("on", sel === saved);
    const season = seasonalOutfit(new Date());
    for (const [sel, button] of outfitButtons) {
      button.classList.toggle("on", sel === parseOutfit(State.settings.mochiOutfit));
      if (sel === "auto") button.title = t("Auto · {outfit}", { outfit: t(OUTFIT_KEYS[season]) });
    }
    drawPreview();
  }

  const skins = h("div", { class: "hub-card hub-skin-card" },
    h("div", { class: "hub-label", text: t("Skin") }),
    h("div", { class: "hub-note", text: t("The window, the pill and Miku all wear this skin.") }),
    skinRow,
  );
  const outfits = h("div", { class: "hub-card" },
    h("div", { class: "hub-label", text: t("Outfit") }),
    h("div", { class: "hub-note", text: t("Auto follows the season — a Santa hat in December, sunglasses in summer.") }),
    outfitRow,
  );

  page.append(h("div", { class: "hub-wardrobe" }, preview, h("div", { class: "hub-wardrobe-side" }, skins, outfits)));
  sync();

  // Miku herself in the preview card, following the skin on screen. The spare
  // height above her is for the tall hats (partyHat, witchHat), which would
  // otherwise have their tip cut off by the canvas.
  liveMochi(previewCanvas as HTMLCanvasElement, "#F5F6F8", "idle", 0.24);
  // The island's wardrobe may change the stored skin while this page is open.
  const off = State.subscribe(() => {
    const shown = skinButtons.get(parseVariant(State.settings.mikuVariant));
    if (shown && !shown.classList.contains("on")) sync();
  });
  ctx.onLeave = () => {
    off();
    // A page left while a swatch was hovered puts the saved skin back.
    State.variantPreview = null;
    State.wardrobePreview = null;
    void Bridge.emitSkinPreview(null);
    const saved = resolveVariant(parseVariant(State.settings.mikuVariant), new Date());
    applySkin(saved);
  };
}
