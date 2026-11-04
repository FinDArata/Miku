// One-shot helper: rewrites the brand names in the *source's* `t("…")` calls so
// they match the keys src/i18n/strings.json and extra.json now carry.
//
//   node scripts/rebrand-source.mjs [--check]
//
// Only string literals that are already the argument of t() / tl() / N_() / tn()
// / tf() / n_() are touched: a brand name inside a comment, an identifier or a
// command line is not user-facing text and is handled by hand (see the rebrand
// commit message). A second run changes nothing.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rebrand } from "./gen-strings.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const WINDOWS = resolve(here, "..");

/** Files whose string literals are user-facing text. */
const DIRS = ["src", "src-tauri/src"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|rs)$/.test(path)) out.push(path);
  }
  return out;
}

/** `t("…")`-style call sites, in TS and Rust alike. */
const CALL = /\b(?:t|tl|tf|n_|N_)\(\s*"((?:[^"\\]|\\.)*)"/g;
/** tn(one, other, n) / tn(one, other, …): the second literal is the key. */
const TN = /\btn\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"/g;

const changed = [];
function rewrite(path, text, check) {
  let next = text;
  const before = text;
  next = next.replace(CALL, (m, s) => {
    const r = rebrand(s);
    return r === s ? m : m.replace(s, r);
  });
  next = next.replace(TN, (m, one, other) => {
    const r1 = rebrand(one);
    const r2 = rebrand(other);
    return r1 === one && r2 === other ? m : m.replace(one, r1).replace(other, r2);
  });
  if (next !== before) {
    changed.push(path);
    if (!check) writeFileSync(path, next);
  }
}

const check = process.argv.includes("--check");
for (const dir of DIRS) {
  for (const path of walk(join(WINDOWS, dir))) rewrite(path, readFileSync(path, "utf8"), check);
}

if (check) {
  if (changed.length) {
    console.error(`${changed.length} files still name the old brand in a t() call:\n${changed.join("\n")}`);
    process.exit(1);
  }
  console.log("No old brand name left in a t() call.");
} else {
  console.log(`Rewrote ${changed.length} files.`);
}
