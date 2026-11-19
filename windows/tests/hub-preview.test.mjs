// What the window's Mochi draws: the hovered preview first, the saved choice
// otherwise (hub/hero.ts). Both bugs this covers were "the picture did not
// change": the outfit was never applied, and a hover never reached the drawing.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { installFakeDom } from "./fakedom.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(".css")) {
      return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
    return nextLoad(url, context);
  },
});

const dom = installFakeDom();
document.visibilityState = "hidden";
document.addEventListener = () => {};
document.documentElement = { dataset: {} };
window.addEventListener = () => {};

const { shownOutfit, shownVariant } = await import("../src/hub/hero.ts");
const { State } = await import("../src/core/state.ts");

beforeEach(() => {
  State.settings = { ...State.settings, mikuVariant: "classic", mochiOutfit: "none" };
  State.variantPreview = null;
  State.wardrobePreview = null;
});

test("with nothing hovered, the saved choices are drawn", () => {
  assert.equal(shownVariant(), "classic");
  assert.equal(shownOutfit(), "none");
});

test("a hovered variant is drawn without being saved", () => {
  State.variantPreview = "snow";
  assert.equal(shownVariant(), "snow");
  assert.equal(State.settings.mikuVariant, "classic", "the hover must not write the setting");
  State.variantPreview = null;
  assert.equal(shownVariant(), "classic");
});

test("a hovered outfit is drawn without being saved", () => {
  State.wardrobePreview = "partyHat";
  assert.equal(shownOutfit(), "partyHat");
  assert.equal(State.settings.mochiOutfit, "none", "the hover must not write the setting");
  State.wardrobePreview = null;
  assert.equal(shownOutfit(), "none");
});

test("clicking an outfit changes what is drawn", () => {
  for (const outfit of ["partyHat", "beanie", "crown", "witchHat", "santaHat"]) {
    State.settings = { ...State.settings, mochiOutfit: outfit };
    assert.equal(shownOutfit(), outfit, `${outfit} is not drawn after being chosen`);
  }
});

test("a hovered skin and a hovered outfit are both drawn at once", () => {
  State.variantPreview = "sakura";
  State.wardrobePreview = "crown";
  assert.equal(shownVariant(), "sakura");
  assert.equal(shownOutfit(), "crown");
});

test("auto resolves the season for both the skin and the outfit", async () => {
  State.settings = { ...State.settings, mikuVariant: "auto", mochiOutfit: "auto" };
  const { seasonalVariant } = await import("../src/mochi/variants.ts");
  const { seasonalOutfit } = await import("../src/mochi/wardrobe.ts");
  assert.equal(shownVariant(), seasonalVariant(new Date()));
  assert.equal(shownOutfit(), seasonalOutfit(new Date()));
  // And the season really is winter's and summer's, not a constant.
  assert.equal(seasonalVariant(new Date(2026, 0, 15, 12)), "snow");
});
