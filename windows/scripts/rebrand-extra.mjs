// Rewrites src/i18n/extra.json's brand names in place: the hand-written table
// has to follow the generator's BRAND map or its keys would stop matching the
// `t("…")` calls in the source. One-shot; safe to run again (a second run finds
// nothing left to change).
//
//   node scripts/rebrand-extra.mjs [--check]
//
// --check exits 1 if anything would change, for CI.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rebrand } from "./gen-strings.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, "../src/i18n/extra.json");

/** Every brand rename applied to both the keys and the translations. */
function rebranded(table) {
  const out = {};
  for (const [key, entry] of Object.entries(table)) {
    const next = {};
    for (const [lang, value] of Object.entries(entry)) {
      next[lang] = typeof value === "string"
        ? rebrand(value)
        : Object.fromEntries(Object.entries(value).map(([k, s]) => [k, rebrand(s)]));
    }
    out[rebrand(key)] = next;
  }
  // Keys stay sorted, like the file was written.
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

const doc = JSON.parse(readFileSync(FILE, "utf8"));
const next = { ...doc, strings: rebranded(doc.strings) };
const text = `${JSON.stringify(next, null, 2)}\n`;
const current = readFileSync(FILE, "utf8");

const changed = Object.keys(doc.strings).filter((k) => rebrand(k) !== k).length;
if (process.argv.includes("--check")) {
  if (text !== current) {
    console.error(`src/i18n/extra.json has ${Object.keys(next.strings).length - Object.keys(doc.strings).length} brand-name keys to rename: run \`node scripts/rebrand-extra.mjs\`.`);
    process.exit(1);
  }
  console.log("src/i18n/extra.json is rebranded.");
} else {
  writeFileSync(FILE, text);
  console.log(`Renamed ${changed} keys in src/i18n/extra.json (${Object.keys(next.strings).length} strings).`);
}
