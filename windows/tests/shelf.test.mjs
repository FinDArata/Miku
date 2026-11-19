// The shelf's labels and filter (src/core/shelf.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { ageLabel, kindOf, matches, sizeLabel, tagOf } from "../src/core/shelf.ts";

test("a file's tag is its extension, upper-case, at most four letters", () => {
  assert.equal(tagOf("rapport-q3.pdf"), "PDF");
  assert.equal(tagOf("contract.final.docx"), "DOCX");
  assert.equal(tagOf("archive.longext"), "LONG");
  assert.equal(tagOf("README"), "");
  assert.equal(tagOf(".gitignore"), "", "a leading dot is a hidden file, not an extension");
  assert.equal(tagOf("trailing."), "");
});

test("kinds follow the extension, whatever its case", () => {
  assert.equal(kindOf("Rapport.PDF"), "docs");
  assert.equal(kindOf("IMG_2041.jpg"), "images");
  assert.equal(kindOf("demo-take3.mp3"), "audio");
  assert.equal(kindOf("island.ts"), "code");
  assert.equal(kindOf("photos.zip"), "other");
  assert.equal(kindOf("README"), "other");
});

test("the filter keeps only its kind; all keeps everything", () => {
  const files = ["a.pdf", "b.png", "c.mp3", "d.ts", "e.zip"].map((name) => ({ name }));
  assert.deepEqual(files.filter((f) => matches(f, "images")).map((f) => f.name), ["b.png"]);
  assert.equal(files.filter((f) => matches(f, "all")).length, 5);
});

test("sizes read as KB, MB, GB", () => {
  assert.equal(sizeLabel(12), "1 KB", "never 0 KB");
  assert.equal(sizeLabel(240 * 1024), "240 KB");
  assert.equal(sizeLabel(5.1 * 1024 * 1024), "5.1 MB");
  assert.equal(sizeLabel(1.4 * 1024 ** 3), "1.4 GB");
});

test("age reads in minutes, hours, then days", () => {
  const now = Date.UTC(2026, 10, 15, 12);
  assert.equal(ageLabel(now, now), "1m", "just now is a minute");
  assert.equal(ageLabel(now - 59 * 60000, now), "59m");
  assert.equal(ageLabel(now - 3 * 3600000, now), "3h");
  assert.equal(ageLabel(now - 6 * 86400000, now), "6d");
  assert.equal(ageLabel(now + 5000, now), "1m", "a clock a little ahead is not negative");
});
