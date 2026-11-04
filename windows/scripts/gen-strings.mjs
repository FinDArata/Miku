// Generates src/i18n/strings.json from the Mac app's string catalog
// (NotchBuddy/Resources/Localizable.xcstrings), so Windows and Linux show the
// Mac's own translations.
//
//   node scripts/gen-strings.mjs           writes src/i18n/strings.json
//   node scripts/gen-strings.mjs --check   fails if the file is out of date
//
// Every entry is keyed by its English text, as the Mac's are (a Mac key such as
// "step.reads" is replaced by its English value, "Reads"). Format specifiers
// become named or numbered placeholders: "%@" and "%lld" → "{0}", "{1}"…
// ("%1$@" keeps its number), renamed where RENAMES says so. Plural entries keep
// their categories ({ "one": …, "other": … }) and are keyed by the English
// "other" form. English is the key itself, so it is not stored.
//
// Strings the Mac does not have (Windows and Linux only) live in
// src/i18n/extra.json, written by hand; see src/i18n/i18n.ts.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, "../../NotchBuddy/Resources/Localizable.xcstrings");
const OUTPUT = resolve(here, "../src/i18n/strings.json");

/** The languages Kanon ships, in the Mac's picker order. English is the source. */
export const LANGUAGES = ["en", "zh-Hans", "hi", "es", "ar", "fr", "bn", "pt-BR", "ru", "id", "de", "tr", "ko", "ja"];

/**
 * Names for the placeholders of the Mac strings the Windows code uses, by Mac
 * key: the n-th specifier becomes `{names[n]}` instead of `{n}`.
 */
const RENAMES = {
  "Auto-close · %llds": ["seconds"],
  "Chat with %@": ["name"],
  "chat.subscriptions.default-model": ["tool"],
  "chat.subscriptions.found": ["tool"],
  "chat.subscriptions.missing": ["tool"],
  "Claude is reading %@…": ["name"],
  "Connected · %@": ["detail"],
  "Key configured · %@": ["model"],
  "Open %@": ["name"],
  "Playing · %@": ["title"],
  "Uploading %@": ["name"],
  "Watching %lld of %lld": ["count", "total"],
  "file.ready %@": ["name"],
  "mail.with %@": ["name"],
  "plan.hours-ago %lld": ["n"],
  "plan.mins-ago %lld": ["n"],
  "plan.reset-in-hm %lld %lld": ["h", "m"],
  "plan.reset-in-m %lld": ["m"],
  "settings.slots-used %lld": ["count"],
  "status.local.connected %lld": ["count"],
  "status.local.no-models %@": ["name"],
  "status.local.unreachable %1$@ %2$@": ["name", "url"],
};

/**
 * The fork's brand, applied on top of the Mac's catalog.
 *
 * The upstream catalog (and its 13 translations) name the app "Coucou" and its
 * mascot "Mochi". This build is "Miku" with a Miku mascot, so every string that
 * names either is rewritten here, in every language, on the way out — including
 * the two the translations write in their own script ("カノン" in Japanese,
 * "모찌" in Korean) and the gender the Mac's English gives Mochi.
 *
 * Keys move with the text (`strings.json` is keyed by its English), which is why
 * this lives in the generator and not in a hand edit of the output: regenerate
 * and the keys, the translations and the source's `t("…")` calls stay in step.
 * Each pair is [what the catalog says, what this build says].
 */
const BRAND = [
  // The name of the app.
  ["Coucou", "Miku"],
  ["coucou", "miku"],
  ["COUCOU", "MIKU"],
  ["カノン", "Miku"], // the earlier fork's Japanese spelling, still in a few strings
  // The mascot.
  ["Mochi", "Miku"],
  ["mochi", "miku"],
  ["Mochis", "Mikus"],
  ["모찌", "미쿠"], // Korean
  // The Mac calls the mascot "he"; Miku is not.
  ["his sounds", "her sounds"],
  ["He sweats", "She sweats"],
  // The wake phrase, and the two-word spellings the Mac's strings use.
  ["OK Kanon", "OK Miku"],
  ["«OK Kanon»", "«OK Miku»"],
  ["« OK Kanon »", "« OK Miku »"],
  ["kanon", "miku"],
  ["Kanon", "Miku"],
];

/**
 * Phrasing that only breaks once the app and the mascot share one name: the
 * catalog has the mascot checking the app's releases, and an agent plugin group
 * named after the app. Applied after BRAND, on the renamed text.
 */
const AFTER = [
  // "Miku checks Miku's releases …" → "Miku checks her own releases …"
  [/\bMiku checks Miku[’']s releases/g, "Miku checks her own releases"],
  // "a hook group named "miku" that Miku did not write" reads fine: the group
  // really is named `miku`. Nothing to do.
];

/** Applies BRAND to a string, then the phrasing fixups unique to this build. */
export function rebrand(text) {
  if (typeof text !== "string") return text;
  let out = text;
  for (const [from, to] of BRAND) out = out.split(from).join(to);
  for (const [re, to] of AFTER) out = out.replace(re, to);
  return out;
}

/** "%@ at %lld" → "{0} at {1}"; "%2$@" → "{1}"; "%%" → "%". */
export function convertFormat(text, names = []) {
  let next = 0;
  return text.replace(/%(?:(\d+)\$)?(@|lld|ld|d|lu|u|f|%)/g, (_m, pos, spec) => {
    if (spec === "%") return "%";
    const index = pos ? Number(pos) - 1 : next++;
    return `{${names[index] ?? index}}`;
  });
}

function unitValue(loc) {
  return loc?.stringUnit?.value;
}

/** A localization as a string, or as plural categories. */
function readLocalization(loc, names) {
  const plural = loc?.variations?.plural;
  if (plural) {
    const out = {};
    for (const [category, v] of Object.entries(plural)) {
      const value = unitValue(v);
      if (typeof value === "string") out[category] = convertFormat(value, names);
    }
    return Object.keys(out).length ? out : undefined;
  }
  const value = unitValue(loc);
  return typeof value === "string" ? convertFormat(value, names) : undefined;
}

export function generate(catalog) {
  const strings = {};
  for (const [macKey, entry] of Object.entries(catalog.strings ?? {})) {
    const names = RENAMES[macKey] ?? [];
    const locs = entry.localizations ?? {};
    // A Mac key with no English localization is its own English text.
    const en = readLocalization(locs.en, names) ?? convertFormat(macKey, names);
    // The brand goes on before anything is keyed: an English string is its own
    // key, so the rename has to happen first or the keys would still say Coucou.
    const branded = (v) => typeof v === "string" ? rebrand(v)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, s]) => [k, rebrand(s)]))
        : v;
    const enOut = branded(en);
    const key = typeof enOut === "string" ? enOut : enOut.other ?? Object.values(enOut)[0];
    const out = {};
    for (const lang of LANGUAGES) {
      if (lang === "en") continue;
      const value = branded(readLocalization(locs[lang], names));
      if (value !== undefined) out[lang] = value;
    }
    // Only a string translated in every language comes across. Xcode keeps every literal it finds in the catalog,
    // brand names and placeholders like " +%@" too, with no translation; and a string still being translated on
    // the Mac shows in English there. Either way Windows has nothing to add, and the tests below would flag it.
    if (LANGUAGES.some((lang) => lang !== "en" && out[lang] === undefined)) continue;
    // The English plural forms are needed to pick "one" in English too.
    if (typeof enOut !== "string") out.en = enOut;
    strings[key] = out;
  }
  const sorted = Object.fromEntries(Object.entries(strings).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return {
    _generated: "By scripts/gen-strings.mjs from NotchBuddy/Resources/Localizable.xcstrings. Do not edit: run `node scripts/gen-strings.mjs`.",
    languages: LANGUAGES,
    strings: sorted,
  };
}

function main() {
  const catalog = JSON.parse(readFileSync(SOURCE, "utf8"));
  const text = `${JSON.stringify(generate(catalog), null, 1)}\n`;
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(OUTPUT, "utf8");
    } catch {
      // missing: out of date
    }
    if (current !== text) {
      console.error("src/i18n/strings.json is out of date: run `node scripts/gen-strings.mjs`.");
      process.exit(1);
    }
    console.log("src/i18n/strings.json is up to date.");
    return;
  }
  writeFileSync(OUTPUT, text);
  const count = Object.keys(JSON.parse(text).strings).length;
  console.log(`Wrote ${count} strings to src/i18n/strings.json`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
