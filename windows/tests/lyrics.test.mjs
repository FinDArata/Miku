// The floating lyrics overlay's two pieces of logic that can be wrong without
// anyone noticing on screen: how LRC becomes lines, and how a line in another
// script is romanised.

import { test } from "node:test";
import assert from "node:assert/strict";

const { parseLrc, readSong, lineIndexAt, cacheKey, mainArtist } = await import("../src/lyrics/lrc.ts");
const { romanizeJapanese, romanizeHangul, romanizeMixed, scriptOf, romanize, useJapanese, romanizeJapaneseFull, languageOfLines, japaneseReady } = await import(
  "../src/lyrics/romanize.ts"
);
const { prefsFrom, DEFAULT_PREFS, autoAction, HIDE_AFTER_PAUSE_MS } = await import("../src/lyrics/state.ts");

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

test("a guest is cut off an artist, but a duo is not", () => {
  assert.equal(mainArtist("A feat. B"), "A");
  assert.equal(mainArtist("A ft. B"), "A");
  assert.equal(mainArtist("A featuring B"), "A");
  assert.equal(mainArtist("A, B feat. C"), "A, B");
  assert.equal(mainArtist("  A  "), "A");
  // A duo is one artist: cutting at "&" filed "Simon & Garfunkel" and Simon's
  // solo work under the same name.
  assert.equal(mainArtist("Simon & Garfunkel"), "Simon & Garfunkel");
  assert.equal(mainArtist("Charli xcx"), "Charli xcx");
  assert.equal(mainArtist("Florence + the Machine"), "Florence + the Machine");
});

test("a track is cached under its whole credit line", () => {
  const key = cacheKey({ artist: "A feat. B", title: "Song", duration: 200.4 });
  assert.equal(key, "a feat. b|song|200");
  // Another guest is another entry now: the words of "A feat. B" are not the
  // words of "A feat. C" (different verse, different mix).
  assert.notEqual(cacheKey({ artist: "A feat. C", title: "song", duration: 200 }), key);
  // The same credit line and title is the same entry, whatever the case.
  assert.equal(cacheKey({ artist: "A FEAT. B", title: "SONG", duration: 200 }), key);
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

/** A fixed tokenizer shaped like kuromoji's: greedy words, the readings a real
 *  dictionary gives (は as the particle is ワ, 晴れ is one word). */
const fakeTokenizer = (map) => ({
  tokenize: (text) => {
    const words = Object.keys(map).sort((a, b) => b.length - a.length);
    const out = [];
    for (let i = 0; i < text.length;) {
      const word = words.find((w) => text.startsWith(w, i));
      if (word) {
        out.push({ surface_form: word, reading: map[word] });
        i += word.length;
      } else {
        out.push({ surface_form: text[i], reading: null });
        i++;
      }
    }
    return out;
  },
});

test("with a dictionary, kanji reads as full rōmaji", () => {
  useJapanese(fakeTokenizer({
    私: "ワタシ", の: "ノ", 心: "ココロ",
    今日: "キョウ", は: "ワ", 晴れ: "ハレ",
    東京: "トウキョウ", タワー: "タワー",
  }));
  assert.equal(japaneseReady(), true);
  assert.equal(romanizeJapaneseFull("私の心"), "watashinokokoro");
  assert.equal(romanizeJapaneseFull("今日は晴れ"), "kyouwahare");
  assert.equal(romanizeJapaneseFull("東京タワー"), "toukyoutawā");
});

test("a Korean line still goes the Hangul way while Japanese is ready", () => {
  assert.equal(romanizeMixed("사랑해"), "Saranghae");
});

test("without a dictionary, Japanese kanji stays as written", () => {
  useJapanese(null);
  assert.equal(japaneseReady(), false);
  assert.equal(romanizeJapaneseFull("私の心"), "私の心");
  assert.equal(romanizeMixed("Kanon ♪ 私の心", "japanese"), "Kanon ♪ 私no心");
});

test("a song's language is decided by its lines, not by one of them", () => {
  assert.equal(languageOfLines(["私の心", "東京へ", "今日は晴れ"]), "japanese");
  assert.equal(languageOfLines(["月亮", "天空", "你好"]), "chinese");
  // One kanji-only line in a kana song does not send it to pinyin.
  assert.equal(languageOfLines(["さようなら", "またね", "私"]), "japanese");
  assert.equal(languageOfLines(["Hello", "world"]), null);
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
  const romanizeOf = (p) => ({ romanize: p.romanize, showOriginal: p.showOriginal });
  assert.deepEqual(romanizeOf(prefsFrom(null)), romanizeOf(DEFAULT_PREFS));
  assert.deepEqual(romanizeOf(prefsFrom({})), romanizeOf(DEFAULT_PREFS));
  assert.deepEqual(romanizeOf(prefsFrom({ lyricsRomanize: false })), { romanize: false, showOriginal: true });
  assert.deepEqual(romanizeOf(prefsFrom({ lyricsShowOriginal: false })), { romanize: true, showOriginal: false });
  // The look's four values always come with defaults, whatever the caller knew.
  assert.deepEqual(
    { opacity: prefsFrom({}).opacity, fontSize: prefsFrom({}).fontSize },
    { opacity: 0.25, fontSize: 16 },
  );
  assert.equal(prefsFrom({}).textColor, "#ffffff");
  assert.equal(prefsFrom({}).background, "#08090c");
});

// ── Opening and closing by itself ─────────────────────────────────────────────

const auto = (o) => autoAction({ enabled: true, up: false, waiting: false, playing: false, hasSong: false, ...o });

test("a pause keeps the card ten seconds, so a skip back is not a stop", () => {
  assert.equal(HIDE_AFTER_PAUSE_MS, 10_000);
});

test("a song starting opens the card, and a song already playing changes nothing", () => {
  assert.equal(auto({ playing: true, hasSong: true }), "show");
  assert.equal(auto({ playing: true, hasSong: true, up: true }), "stay");
});

test("a pause waits once, then the caller hides it", () => {
  assert.equal(auto({ playing: false, hasSong: true, up: true }), "wait");
  // Already counting: a second event must not restart the grace period.
  assert.equal(auto({ playing: false, hasSong: true, up: true, waiting: true }), "stay");
  // Hidden already, nothing to wait for.
  assert.equal(auto({ playing: false, hasSong: true, up: false }), "stay");
});

test("nothing loaded hides at once, without a grace period", () => {
  assert.equal(auto({ up: true }), "hide");
  assert.equal(auto({ up: false }), "stay");
});

test("the switch in Settings is the master: off, nothing happens on its own", () => {
  assert.equal(auto({ enabled: false, playing: true, hasSong: true }), "stay");
  assert.equal(auto({ enabled: false, up: true }), "stay");
});
