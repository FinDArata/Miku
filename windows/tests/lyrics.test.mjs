// The floating lyrics overlay's two pieces of logic that can be wrong without
// anyone noticing on screen: how LRC becomes lines, and how a line in another
// script is romanised.

import { test } from "node:test";
import assert from "node:assert/strict";

const { parseLrc, readSong, lineIndexAt, cacheKey, mainArtist } = await import("../src/lyrics/lrc.ts");
const { romanizeJapanese, romanizeHangul, romanizeMixed, scriptOf, romanize } = await import(
  "../src/lyrics/romanize.ts"
);
const { prefsFrom, DEFAULT_PREFS } = await import("../src/lyrics/state.ts");

// ── LRC ───────────────────────────────────────────────────────────────────────

test("a timed line is read with its seconds", () => {
  const lines = parseLrc("[00:12.50]first\n[01:02.25]second");
  assert.deepEqual(lines, [
    { at: 12.5, text: "first" },
    { at: 62.25, text: "second" },
  ]);
});

test("header tags are not lines, and offset moves every line", () => {
  const lines = parseLrc("[ar:Someone]\n[ti:A song]\n[offset:-500]\n[00:10.00]line");
  assert.deepEqual(lines, [{ at: 9.5, text: "line" }]);
});

test("several timestamps on one line make one line per timestamp, in order", () => {
  const lines = parseLrc("[00:20.00][00:40.00][01:00.00]chorus");
  assert.deepEqual(lines.map((l) => l.at), [20, 40, 60]);
  assert.ok(lines.every((l) => l.text === "chorus"));
});

test("lines are sorted even when the file is not", () => {
  const lines = parseLrc("[00:30.00]later\n[00:05.00]earlier");
  assert.deepEqual(lines.map((l) => l.text), ["earlier", "later"]);
});

test("the offset applies to the whole file, wherever the tag sits", () => {
  // A line pushed before zero starts at zero rather than disappearing.
  assert.deepEqual(parseLrc("[00:01.00]x\n[offset:-5000]"), [{ at: 0, text: "x" }]);
  assert.deepEqual(parseLrc("[offset:-500]\n[00:01.00]x"), [{ at: 0.5, text: "x" }]);
  assert.deepEqual(parseLrc("[00:01.00]x\n[offset:1000]"), [{ at: 2, text: "x" }]);
});

test("milliseconds of three digits are read as such", () => {
  assert.deepEqual(parseLrc("[00:20.123]x"), [{ at: 20.123, text: "x" }]);
});

test("plain words are used when there is no timing at all", () => {
  const song = readSong(null, "  one \n\n two  \n");
  assert.deepEqual(song.timed, []);
  assert.deepEqual(song.plain, ["one", "two"]);
});

test("synced wins over plain when both are there", () => {
  const song = readSong("[00:01.00]a", "b");
  assert.deepEqual(song.timed, [{ at: 1, text: "a" }]);
  assert.deepEqual(song.plain, []);
});

test("no words at all is an empty song, not an error", () => {
  assert.deepEqual(readSong(null, null), { timed: [], plain: [] });
  assert.deepEqual(readSong("", "  "), { timed: [], plain: [] });
});

test("the sung line is the last one that has started", () => {
  const lines = parseLrc("[00:10.00]a\n[00:20.00]b\n[00:30.00]c");
  assert.equal(lineIndexAt(lines, 0), -1);
  assert.equal(lineIndexAt(lines, 9.99), -1);
  assert.equal(lineIndexAt(lines, 10), 0);
  assert.equal(lineIndexAt(lines, 19.9), 0);
  assert.equal(lineIndexAt(lines, 20), 1);
  assert.equal(lineIndexAt(lines, 999), 2);
});

test("a track is asked about by its main artist, and cached by all of it", () => {
  assert.equal(mainArtist("A feat. B"), "A");
  assert.equal(mainArtist("A, B & C"), "A");
  assert.equal(mainArtist("  A  "), "A");
  const key = cacheKey({ artist: "A feat. B", title: "Song", duration: 200.4 });
  assert.equal(key, "a|song|200");
  // The same song with another featured artist is the same cache entry.
  assert.equal(cacheKey({ artist: "A feat. C", title: "song", duration: 200 }), key);
});

// ── Romanisation ──────────────────────────────────────────────────────────────

test("kana reads as lowercase Hepburn", () => {
  assert.equal(romanizeJapanese("ひらがな"), "hiragana");
  assert.equal(romanizeJapanese("カタカナ"), "katakana");
  assert.equal(romanizeJapanese("きょう"), "kyou");
  assert.equal(romanizeJapanese("しゃしん"), "shashin");
});

test("a small っ doubles the next consonant, and ん takes its n'", () => {
  assert.equal(romanizeJapanese("がっこう"), "gakkou");
  assert.equal(romanizeJapanese("ちょっと"), "chotto");
  assert.equal(romanizeJapanese("しんいち"), "shin'ichi");
  assert.equal(romanizeJapanese("しんぶん"), "shinbun");
});

test("a held vowel gets a macron", () => {
  assert.equal(romanizeJapanese("ラーメン"), "rāmen");
  assert.equal(romanizeJapanese("コーヒー"), "kōhī");
});

test("kanji is left as it is, so a line is never emptied", () => {
  assert.equal(romanizeJapanese("東京タワー"), "東京tawā");
  assert.equal(romanizeJapanese("私の心"), "私no心");
});

test("Hangul reads as Revised Romanization, with the final carried over", () => {
  assert.equal(romanizeHangul("사랑해"), "Saranghae");
  assert.equal(romanizeHangul("안녕하세요"), "Annyeonghaseyo");
  assert.equal(romanizeHangul("있어"), "Isseo");
  assert.equal(romanizeHangul("한국어"), "Hangugeo");
});

test("the script of a line is its own", () => {
  assert.equal(scriptOf("hello"), "latin");
  assert.equal(scriptOf("きょう"), "kana");
  assert.equal(scriptOf("사랑"), "hangul");
  assert.equal(scriptOf("月亮"), "han");
  // A Japanese line with kanji is Japanese: kana wins.
  assert.equal(scriptOf("東京タワー"), "kana");
});

test("a Latin line is never touched", () => {
  const line = "Hello, world — it's 2024!";
  assert.equal(romanize(line), line);
  assert.equal(romanizeMixed(line), line);
});

test("a mixed line keeps its Latin words and romanises the rest", () => {
  assert.equal(romanizeMixed("Kanon ♪ 私の心"), "Kanon ♪ 私no心");
  assert.equal(romanizeMixed("Hello カタカナ world"), "Hello katakana world");
});

test("Chinese is left alone until the pinyin library is there", () => {
  // It is loaded on the first Chinese line; before that, the line as written.
  assert.equal(typeof romanize("月亮"), "string");
});

// ── Preferences ───────────────────────────────────────────────────────────────

test("preferences default to on, and a stored false is respected", () => {
  assert.deepEqual(prefsFrom(null), DEFAULT_PREFS);
  assert.deepEqual(prefsFrom({}), DEFAULT_PREFS);
  assert.deepEqual(prefsFrom({ lyricsRomanize: false }), { romanize: false, showOriginal: true });
  assert.deepEqual(prefsFrom({ lyricsShowOriginal: false }), { romanize: true, showOriginal: false });
});
