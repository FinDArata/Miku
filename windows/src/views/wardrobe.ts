// Wardrobe view — port of WardrobeView (IslandViewContent.swift). Opened with a
// right-click on Miku or from the tray menu. Resting the pointer on a button
// tries the outfit on Miku; a click keeps it.
//
// The second row picks which Miku is drawn at all (classic, Snow, Sakura, or the
// season's), which is this build's own addition: the outfit dresses her, the
// variant is her.

import { h } from "./dom";
import { State } from "../core/state";
import { drawWardrobeIcon } from "../mochi/outfits";
import {
  OUTFIT_KEYS, OUTFIT_SELECTIONS, WARDROBE_STRINGS, parseOutfit, resolveOutfit, seasonalOutfit,
  wardrobeHeader, type Outfit, type OutfitSelection,
} from "../mochi/wardrobe";
import {
  VARIANT_KEYS, VARIANT_SELECTIONS, parseVariant, variantHeader,
  type VariantSelection,
} from "../mochi/wardrobe";
import { MIKU_VARIANTS, seasonalVariant } from "../mochi/variants";
import type { ViewActions, ViewHost } from "./views";
import { language, tl } from "../i18n/i18n";

const ICON = 28;

export function buildWardrobe(actions: ViewActions): ViewHost {
  const note = h("span", { class: "wardrobe-note" });
  const grid = h("div", { class: "wardrobe-grid" });
  const variantRow = h("div", { class: "wardrobe-grid wardrobe-variants" });
  const el = h(
    "div",
    { class: "view wardrobe" },
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "stack wardrobe-stack" },
        h("div", { class: "wardrobe-head" }, h("span", { class: "wardrobe-title", text: tl("Wardrobe") }), note),
        grid,
        variantRow,
      ),
    ),
  );

  let hovered: OutfitSelection | null = null;
  let hoveredVariant: VariantSelection | null = null;
  let drawnSeason: Outfit | null = null;
  let drawnLanguage = language();
  let drawnDpr = 0;
  const items = new Map<OutfitSelection, { button: HTMLButtonElement; canvas: HTMLCanvasElement }>();
  const variantItems = new Map<VariantSelection, HTMLButtonElement>();

  /** The note follows whichever row the pointer is in. */
  const updateNote = () => {
    if (hoveredVariant || (!hovered && hoveredVariant !== null)) {
      const sel = parseVariant(State.settings.mikuVariant);
      note.textContent = variantHeader(hoveredVariant, sel, new Date());
      return;
    }
    note.textContent = wardrobeHeader(hovered, parseOutfit(State.settings.mochiOutfit), new Date());
  };

  for (const sel of OUTFIT_SELECTIONS) {
    const canvas = h("canvas");
    const button = h(
      "button",
      { class: "wardrobe-item", title: tl(OUTFIT_KEYS[sel]), "aria-label": tl(OUTFIT_KEYS[sel]) },
      canvas,
    );
    button.addEventListener("mouseenter", () => {
      hovered = sel;
      hoveredVariant = null;
      actions.previewOutfit(resolveOutfit(sel, new Date()));
      updateNote();
    });
    button.addEventListener("mouseleave", () => {
      if (hovered !== sel) return;
      hovered = null;
      actions.previewOutfit(null);
      updateNote();
    });
    button.addEventListener("click", () => actions.chooseOutfit(sel));
    items.set(sel, { button, canvas });
    grid.append(button);
  }

  // ── Which Miku ──
  // A swatch of each variant's hair beside her colour; "auto" shows the
  // season's, so the row says what would be drawn without being asked.
  for (const sel of VARIANT_SELECTIONS) {
    const swatch = h("span", { class: "wardrobe-swatch" });
    if (sel === "auto") {
      swatch.classList.add("wardrobe-swatch-auto");
      swatch.textContent = WARDROBE_STRINGS.autoBadge;
    } else {
      const v = MIKU_VARIANTS[sel];
      const rgb = v.hair.map((c) => Math.round(c * 255)).join(",");
      swatch.style.background = `rgb(${rgb})`;
    }
    const button = h(
      "button",
      {
        class: "wardrobe-item wardrobe-variant",
        title: tl(VARIANT_KEYS[sel]),
        "aria-label": tl(VARIANT_KEYS[sel]),
      },
      swatch,
    );
    button.addEventListener("mouseenter", () => {
      hoveredVariant = sel;
      hovered = null;
      // Try it on at once; the island reads the same settings the click writes.
      actions.previewVariant(sel === "auto" ? null : sel);
      updateNote();
    });
    button.addEventListener("mouseleave", () => {
      if (hoveredVariant !== sel) return;
      hoveredVariant = null;
      actions.previewVariant(null);
      updateNote();
    });
    button.addEventListener("click", () => actions.chooseVariant(sel));
    variantItems.set(sel, button);
    variantRow.append(button);
  }

  /** Icons are drawn once; only "auto" changes, with the season and its badge's language. */
  const drawIcons = () => {
    const season = seasonalOutfit(new Date());
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (season === drawnSeason && drawnLanguage === language() && drawnDpr === dpr) return;
    // On a monitor of another scale every icon is drawn again, sharp and whole.
    const first = drawnSeason == null || drawnDpr !== dpr;
    drawnSeason = season;
    drawnLanguage = language();
    drawnDpr = dpr;
    for (const [sel, { canvas }] of items) {
      if (!first && sel !== "auto") continue;
      canvas.width = Math.round(ICON * dpr);
      canvas.height = Math.round(ICON * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawWardrobeIcon(ctx, ICON, sel, season, WARDROBE_STRINGS.autoBadge);
    }
  };

  return {
    el,
    sync() {
      drawIcons();
      // The island drops the preview when the view closes: so does the hover.
      if (State.wardrobePreview == null) hovered = null;
      const current = parseOutfit(State.settings.mochiOutfit);
      for (const [sel, { button }] of items) button.classList.toggle("on", sel === current);
      // The "auto" swatch follows the season, so it shows the colour in force.
      const autoSel = variantItems.get("auto");
      if (autoSel) {
        const sw = autoSel.querySelector(".wardrobe-swatch") as HTMLElement | null;
        if (sw) {
          const v = MIKU_VARIANTS[seasonalVariant(new Date())];
          sw.style.background = `rgb(${v.hair.map((c) => Math.round(c * 255)).join(",")})`;
        }
      }
      const currentVariant = parseVariant(State.settings.mikuVariant);
      for (const [sel, button] of variantItems) button.classList.toggle("on", sel === currentVariant);
      updateNote();
    },
  };
}
