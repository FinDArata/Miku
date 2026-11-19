// The skins: the wardrobe's three Miku, as whole-interface themes
// (src/theme/skins.ts). Each variant must paint every property the CSS reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SKIN_CACHE_KEY, SKIN_IDS, SKIN_THEMES, applySkin, cachedSkin, currentSkin, skinProperties,
  themeFor, variantPalette,
} from "../src/theme/skins.ts";
import { MIKU_VARIANT_IDS, MIKU_VARIANTS, seasonalVariant } from "../src/mochi/variants.ts";
import { parseVariant, resolveVariant } from "../src/mochi/wardrobe.ts";
import { skinOf } from "../src/theme/sync.ts";
import { DEFAULT_SETTINGS } from "../src/core/state.ts";

/** A style object that records what the theme writes. */
function fakeStyle() {
  const written = new Map();
  return { written, setProperty: (name, value) => written.set(name, value) };
}

test("every variant of the wardrobe has a skin, and nothing else does", () => {
  assert.deepEqual([...SKIN_IDS].sort(), [...MIKU_VARIANT_IDS].sort());
  assert.deepEqual(Object.keys(SKIN_THEMES).sort(), [...MIKU_VARIANT_IDS].sort());
});

test("each skin sets every property the stylesheets read", () => {
  const required = [
    "--skin-accent", "--skin-accent-bright", "--skin-accent-deep", "--skin-accent-soft",
    "--skin-accent-line", "--skin-on-accent", "--skin-panel", "--skin-card", "--skin-field",
    "--skin-line", "--skin-text", "--skin-body", "--skin-secondary", "--skin-muted",
    "--skin-hero-base", "--skin-accent-rgb", "--skin-accent-bright-rgb",
  ];
  for (const id of SKIN_IDS) {
    const props = skinProperties(SKIN_THEMES[id]);
    for (const name of required) assert.ok(name in props, `${id} is missing ${name}`);
    for (const [name, value] of Object.entries(props)) {
      assert.equal(typeof value, "string", `${id} ${name}`);
      assert.ok(value.length > 0, `${id} ${name} is empty`);
    }
  }
});

test("the colours are CSS colours, and the rgb channels match the accent", () => {
  for (const id of SKIN_IDS) {
    const theme = SKIN_THEMES[id];
    for (const key of ["accent", "accentBright", "accentDeep", "panel", "card", "field", "text", "body", "heroBase"]) {
      assert.match(theme[key], /^#[0-9a-f]{6}$/, `${id}.${key} is not a hex colour`);
    }
    for (const key of ["accentSoft", "accentLine", "line"]) {
      assert.match(theme[key], /^rgba\([\d,. ]+\)$/, `${id}.${key} is not rgba`);
    }
    // The accent the CSS gets as channels is the same colour as the hex one.
    const [r, g, b] = theme.accent.slice(1).match(/../g).map((h) => parseInt(h, 16));
    assert.equal(theme.accent.slice(1), [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join(""));
    assert.equal(skinProperties(theme)["--skin-accent-rgb"], [r, g, b].join(","));
  }
});

test("the accent of each skin is a colour of that Miku's own palette", () => {
  for (const id of SKIN_IDS) {
    const { tie } = MIKU_VARIANTS[id];
    const accent = SKIN_THEMES[id].accent.slice(1).match(/../g).map((h) => parseInt(h, 16));
    // The palette and the skin may be written in different precision.
    tie.forEach((c, i) => {
      const want = Math.round(c * 255);
      assert.ok(Math.abs(accent[i] - want) <= 1, `${id}: channel ${i} ${accent[i]} vs ${want}`);
    });
  }
});

test("classic is the default, and unknown ids fall back to it", () => {
  assert.equal(themeFor("classic").id, "classic");
  assert.equal(themeFor("nope").id, "classic");
  assert.equal(currentSkin(), "classic");
  // The default settings ask for "auto", which is never worse than classic.
  assert.ok(SKIN_IDS.includes(parseVariant(DEFAULT_SETTINGS.mikuVariant) === "auto"
    ? seasonalVariant(new Date())
    : parseVariant(DEFAULT_SETTINGS.mikuVariant)));
});

test("applySkin writes every property and remembers the skin", () => {
  const style = fakeStyle();
  applySkin("snow", style);
  assert.equal(currentSkin(), "snow");
  for (const name of Object.keys(skinProperties(SKIN_THEMES.snow))) {
    assert.ok(style.written.has(name), `${name} was not written`);
  }
  assert.equal(style.written.get("--skin-accent"), SKIN_THEMES.snow.accent);
  applySkin("classic", style);
  assert.equal(currentSkin(), "classic");
});

test("a skin without a style sink still records the current skin", () => {
  applySkin("sakura", null);
  assert.equal(currentSkin(), "sakura");
  assert.equal(themeFor(currentSkin()).id, "sakura");
  applySkin("classic", null);
});

test("cachedSkin remembers the last launch's skin, and nothing else", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  try {
    applySkin("snow", fakeStyle());
    assert.equal(store.get(SKIN_CACHE_KEY), "snow");
    assert.equal(cachedSkin(), "snow");
    store.set(SKIN_CACHE_KEY, "garbage");
    assert.equal(cachedSkin(), null, "an unknown value is not a skin");
    store.delete(SKIN_CACHE_KEY);
    assert.equal(cachedSkin(), null);
  } finally {
    delete globalThis.localStorage;
  }
});

test("the seasons dress the window like they dress Miku", () => {
  const day = (m, d) => new Date(2026, m - 1, d, 12);
  assert.equal(resolveVariant("auto", day(12, 20)), "snow");
  assert.equal(resolveVariant("auto", day(1, 15)), "snow");
  assert.equal(resolveVariant("auto", day(2, 28)), "snow");
  assert.equal(resolveVariant("auto", day(3, 1)), "sakura");
  assert.equal(resolveVariant("auto", day(4, 30)), "sakura");
  assert.equal(resolveVariant("auto", day(5, 1)), "classic");
  assert.equal(resolveVariant("auto", day(9, 1)), "classic");
  // And the theme helper follows the same rule.
  for (const [m, d, want] of [[12, 20, "snow"], [3, 10, "sakura"], [7, 1, "classic"]]) {
    assert.equal(skinOf("auto", day(m, d)).id, want);
  }
});

test("a chosen skin ignores the season", () => {
  const winter = new Date(2026, 0, 15, 12);
  assert.equal(skinOf("sakura", winter).id, "sakura");
  assert.equal(resolveVariant("classic", winter), "classic");
});

test("variantPalette is the wardrobe's palette", () => {
  for (const id of SKIN_IDS) assert.equal(variantPalette(id), MIKU_VARIANTS[id]);
});
