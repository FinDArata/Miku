// The floating lyrics overlay's two pieces of logic that can be wrong without
// anyone noticing on screen: how LRC becomes lines, and how a line in another
// script is romanised.

import { test } from "node:test";
import assert from "node:assert/strict";

const { parseLrc, parseYrc, readSong, lineIndexAt, nextSungLine, previousSungLine, sungFraction, instrumentalAt, syllables, cacheKey, mainArtist } = await import("../src/lyrics/lrc.ts");
const { romanizeJapanese, romanizeHangul, romanizeMixed, scriptOf, romanize, useJapanese, romanizeJapaneseFull, languageOfLines, japaneseReady } = await import(
  "../src/lyrics/romanize.ts"
);
const { prefsFrom, DEFAULT_PREFS, autoAction, HIDE_AFTER_PAUSE_MS, HOLD_MAX_MS, holdStillUp } = await import("../src/lyrics/state.ts");

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

test("a stamped gap holds the line before it instead of blanking the card", () => {
  // LRCLIB's real LRC for "Heart of Lahai-Roi" carries "[00:04.29] " for the
  // intro. Reading that gap as the current line left the card showing a title
  // and no words at all, for as long as the break lasted.
  const lines = parseLrc("[00:00.99]Eclipse\n[00:04.29] \n[00:18.94]Elevate\n[00:49.70] ");
  assert.equal(lines.length, 4, "the gap is still a line in the file");
  assert.equal(lines[1].text, "");
  // Before the first line there is nothing to hold.
  assert.equal(lineIndexAt(lines, 0.5), -1);
  // The first line, then the gap: the words stay.
  assert.equal(lineIndexAt(lines, 1), 0);
  assert.equal(lineIndexAt(lines, 5), 0);
  assert.equal(lineIndexAt(lines, 10), 0);
  // Past the second gap, the line before it holds too.
  assert.equal(lineIndexAt(lines, 19), 2, "skips the gap stamped at 4.29");
  assert.equal(lineIndexAt(lines, 50), 2);
});

test("the lines around the sung one skip the gaps", () => {
  // The card shows "past" and "next"; both must be real lines.
  const lines = parseLrc("[00:01.00]one\n[00:05.00] \n[00:10.00]two\n[00:15.00] \n[00:20.00]three");
  const at = lineIndexAt(lines, 10);
  assert.equal(lines[at].text, "two");
  const before = previousSungLine(lines, at);
  const after = nextSungLine(lines, at);
  assert.equal(lines[before].text, "one", "skips the 05:00 gap");
  assert.equal(lines[after].text, "three", "skips the 15:00 gap");
  // The ends have nothing beyond them.
  assert.equal(previousSungLine(lines, 0), -1);
  assert.equal(nextSungLine(lines, lines.length - 1), -1);
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
  assert.equal(romanizeJapaneseFull("私の心"), "watashi no kokoro");
  assert.equal(romanizeJapaneseFull("今日は晴れ"), "kyou wa hare");
  assert.equal(romanizeJapaneseFull("東京タワー"), "toukyou tawā");
});

/** A tokenizer shaped like the real dictionary: the tags the word-gluing
 *  rules read (pos, detail, conjugation), matched greedily wherever they sit. */
const tokenizerOf = (tokens) => ({
  tokenize: (text) => {
    const out = [];
    for (let i = 0; i < text.length;) {
      const t = tokens.find((x) => text.startsWith(x.surface_form, i));
      if (t) {
        out.push(t);
        i += t.surface_form.length;
      } else {
        out.push({ surface_form: text[i], reading: null });
        i++;
      }
    }
    return out;
  },
});

test("a compound verb the dictionary cut apart reads as one word", () => {
  // IPADIC has no 駆け巡る: it comes out 駆け|巡る, both 動詞/自立, the first
  // in the 連用形 — written and sung as one word, no space between.
  useJapanese(tokenizerOf([
    { surface_form: "駆け", pos: "動詞", pos_detail_1: "自立", conjugated_form: "連用形", reading: "カケ" },
    { surface_form: "巡る", pos: "動詞", pos_detail_1: "自立", conjugated_form: "基本形", reading: "メグル" },
  ]));
  assert.equal(romanizeJapaneseFull("駆け巡る"), "kakemeguru");
});

test("力 the dictionary tags as the -ryoku suffix still reads chikara", () => {
  // 悲しみ怒り力に (CHEMISTRY, Period): kuromoji picks 力[名詞/接尾/リョク]
  // after the noun, and the suffix would glue it on — the song says
  // "ikari chikara", two words.
  useJapanese(tokenizerOf([
    { surface_form: "悲しみ", pos: "名詞", pos_detail_1: "一般", reading: "カナシミ" },
    { surface_form: "怒り", pos: "名詞", pos_detail_1: "一般", reading: "イカリ" },
    { surface_form: "力", pos: "名詞", pos_detail_1: "接尾", reading: "リョク" },
    { surface_form: "に", pos: "助詞", pos_detail_1: "格助詞", reading: "ニ" },
  ]));
  assert.equal(romanizeJapaneseFull("悲しみ怒り力に"), "kanashimi ikari chikara ni");
});

test("辿り着く reads tsu: the spelling is rewritten to the たどり着く it knows", () => {
  // The dictionary parses 辿る + 着る ("to wear"), so 着 came out "ki"
  // (tadori-kiita); たどり着く it knows whole.
  useJapanese(tokenizerOf([
    { surface_form: "たどり着い", pos: "動詞", pos_detail_1: "自立", conjugated_form: "連用タ接続", reading: "タドリツイ" },
    { surface_form: "た", pos: "助動詞", reading: "タ" },
  ]));
  assert.equal(romanizeJapaneseFull("辿り着いた"), "tadoritsuita");
});

test("a sung word never glues onto the word before it", () => {
  // 側 the dictionary tags a suffix (ガワ) after ずっと, but the song says
  // soba there — two words. こちら側 keeps its gawa and stays one word.
  useJapanese(tokenizerOf([
    { surface_form: "ずっと", pos: "副詞", pos_detail_1: "一般", reading: "ズット" },
    { surface_form: "側", pos: "名詞", pos_detail_1: "接尾", reading: "ガワ" },
    { surface_form: "で", pos: "助詞", pos_detail_1: "格助詞", reading: "デ" },
    { surface_form: "こちら", pos: "名詞", pos_detail_1: "代名詞", reading: "コチラ" },
  ]));
  assert.equal(romanizeJapaneseFull("ずっと側で"), "zutto soba de");
  assert.equal(romanizeJapaneseFull("こちら側"), "kochiragawa");
});

test("a Korean line still goes the Hangul way while Japanese is ready", () => {
  assert.equal(romanizeMixed("사랑해"), "saranghae");
});

test("without a dictionary, Japanese kanji stays as written", () => {
  useJapanese(null);
  assert.equal(japaneseReady(), false);
  assert.equal(romanizeJapaneseFull("私の心"), "私の心");
  assert.equal(romanizeMixed("Kanon ♪ 私の心", "japanese"), "Kanon ♪ 私no心");
});

test("a song's language is decided by its characters, not by one line", () => {
  assert.equal(languageOfLines(["私の心", "東京へ", "今日は晴れ"]), "japanese");
  assert.equal(languageOfLines(["月亮", "天空", "你好"]), "chinese");
  // One kanji-only line in a kana song does not send it to pinyin.
  assert.equal(languageOfLines(["さようなら", "またね", "私"]), "japanese");
  // Nor does a kanji-heavy song lose the dictionary: one kana settles it.
  assert.equal(languageOfLines(["東京", "空", "世界", "心", "私の心"]), "japanese");
  assert.equal(languageOfLines(["Hello", "world"]), null);
});

test("Hangul reads as Revised Romanization, with the final carried over", () => {
  assert.equal(romanizeHangul("사랑해"), "saranghae");
  assert.equal(romanizeHangul("안녕하세요"), "annyeonghaseyo");
  assert.equal(romanizeHangul("있어"), "isseo");
  assert.equal(romanizeHangul("한국어"), "hangugeo");
});

test("Hangul is lowercase word by word, never capitalised mid-line", () => {
  assert.equal(romanizeMixed("빨리 와"), "ppalli wa");
  assert.equal(romanizeMixed("너를 사랑해 Baby"), "neoreul saranghae Baby");
});

test("Hangul sound changes across a syllable: nasal, liquid, ㅎ, palatal", () => {
  assert.equal(romanizeHangul("합니다"), "hamnida");
  assert.equal(romanizeHangul("국물"), "gungmul");
  assert.equal(romanizeHangul("신라"), "silla");
  assert.equal(romanizeHangul("빨리"), "ppalli");
  assert.equal(romanizeHangul("종로"), "jongno");
  assert.equal(romanizeHangul("좋아"), "joa");
  assert.equal(romanizeHangul("좋다"), "jota");
  assert.equal(romanizeHangul("축하"), "chuka");
  assert.equal(romanizeHangul("같이"), "gachi");
  assert.equal(romanizeHangul("굳이"), "guji");
  // No change across a space: each word is said on its own.
  assert.equal(romanizeHangul("국 물"), "guk mul");
});

test("Japanese punctuation reads as Latin, and a dash is not a long vowel", () => {
  assert.equal(romanizeJapanese("あい—ずっと"), "ai—zutto");
  assert.equal(romanizeJapanese("あっ、まって"), "a, matte");
  assert.equal(romanizeJapanese("「まっちゃ」"), "“matcha”");
});

/** Tokens with kuromoji's parts of speech, as the real dictionary gives them. */
const posTokenizer = (tokens) => ({ tokenize: () => tokens });

test("with parts of speech, particles are said as sung and words stay whole", () => {
  useJapanese(posTokenizer([
    { surface_form: "私", reading: "ワタシ", pos: "名詞" },
    { surface_form: "は", reading: "ハ", pos: "助詞", pos_detail_1: "係助詞" },
    { surface_form: "東京", reading: "トウキョウ", pos: "名詞" },
    { surface_form: "へ", reading: "ヘ", pos: "助詞", pos_detail_1: "格助詞" },
    { surface_form: "行き", reading: "イキ", pos: "動詞", pos_detail_1: "自立" },
    { surface_form: "たい", reading: "タイ", pos: "助動詞" },
  ]));
  assert.equal(romanizeJapaneseFull("私は東京へ行きたい"), "watashi wa toukyou e ikitai");
  useJapanese(posTokenizer([
    { surface_form: "待っ", reading: "マッ", pos: "動詞", pos_detail_1: "自立" },
    { surface_form: "て", reading: "テ", pos: "助詞", pos_detail_1: "接続助詞" },
    { surface_form: "、", reading: "、", pos: "記号" },
    { surface_form: "ね", reading: "ネ", pos: "助詞", pos_detail_1: "終助詞" },
  ]));
  assert.equal(romanizeJapaneseFull("待って、ね"), "matte, ne");
  useJapanese(null);
});

test("々 and full-width punctuation stay inside the Japanese run", () => {
  // 時 + 々 cut apart: the word is written out (時時) and read again.
  useJapanese({
    tokenize: (text) => text.includes("々")
      ? [{ surface_form: "時", reading: "トキ", pos: "名詞" }, { surface_form: "々", reading: null, pos: "記号" }]
      : [{ surface_form: "時時", reading: "トキドキ", pos: "副詞" }, { surface_form: "！", reading: "！", pos: "記号" }],
  });
  assert.equal(romanizeMixed("時々！", "japanese"), "tokidoki!");
  useJapanese(null);
});

test("a lyric kanji the dictionary cannot read is written out first", () => {
  const seen = [];
  useJapanese({ tokenize: (text) => { seen.push(text); return [{ surface_form: "煌", reading: null, pos: "名詞" }]; } });
  assert.equal(romanizeJapaneseFull("燦きに"), "kou");
  assert.equal(seen[0], "きらめきに");
  useJapanese(null);
});

test("二人 and 一人 are read futari and hitori, as a song says them", () => {
  // The dictionary cuts them into number + counter (ni-nin, ichi-nin);
  // neighbouring tokens are stitched back into the sung word.
  useJapanese({ tokenize: () => [
    { surface_form: "二", reading: "ニ", pos: "名詞" },
    { surface_form: "人", reading: "ジン", pos: "名詞" },
    { surface_form: "で", reading: "デ", pos: "助詞", pos_detail_1: "格助詞" },
    { surface_form: "一人", reading: "ヒトリ", pos: "名詞" },
  ] });
  assert.equal(romanizeJapaneseFull("二人で一人"), "futari de hitori");
  useJapanese(null);
});

test("a sung word never reaches inside another: 一人称 keeps its own reading", () => {
  useJapanese({ tokenize: () => [{ surface_form: "一人称", reading: "イチニンショウ", pos: "名詞" }] });
  assert.equal(romanizeJapaneseFull("一人称"), "ichininshou");
  useJapanese(null);
});

test("kanji the dictionary reads wrong are read as sung, at their own token", () => {
  // 君の側に: the dictionary says gawa; a song says soba — after の.
  useJapanese({ tokenize: () => [
    { surface_form: "君", reading: "キミ", pos: "名詞" },
    { surface_form: "の", reading: "ノ", pos: "助詞", pos_detail_1: "格助詞" },
    { surface_form: "側", reading: "ガワ", pos: "名詞" },
    { surface_form: "に", reading: "ニ", pos: "助詞", pos_detail_1: "格助詞" },
  ] });
  assert.equal(romanizeJapaneseFull("君の側に"), "kimi no soba ni");
  // 向こう側 is its own token: the dictionary's gawa stays.
  useJapanese({ tokenize: () => [{ surface_form: "向こう側", reading: "ムコウガワ", pos: "名詞" }] });
  assert.equal(romanizeJapaneseFull("向こう側"), "mukougawa");
  // 傍ら is its own word; bare 傍 is soba.
  useJapanese({ tokenize: () => [{ surface_form: "傍ら", reading: "カタワラ", pos: "名詞" }] });
  assert.equal(romanizeJapaneseFull("傍ら"), "katawara");
  useJapanese({ tokenize: () => [{ surface_form: "傍", reading: "ガワ", pos: "名詞" }] });
  assert.equal(romanizeJapaneseFull("傍"), "soba");
  // The rest of the sung words, whole tokens.
  useJapanese({ tokenize: (text) => [{ surface_form: text, reading: null, pos: "名詞" }] });
  assert.equal(romanizeJapaneseFull("何て"), "nante");
  assert.equal(romanizeJapaneseFull("その後"), "sonoato");
  assert.equal(romanizeJapaneseFull("貴女"), "anata");
  assert.equal(romanizeJapaneseFull("其処"), "soko");
  assert.equal(romanizeJapaneseFull("如何して"), "doushite");
  assert.equal(romanizeJapaneseFull("一番星"), "ichibanboshi");
  assert.equal(romanizeJapaneseFull("秋桜"), "kosumosu");
  assert.equal(romanizeJapaneseFull("蒲公英"), "tanpopo");
  useJapanese(null);
});

test("half-width katakana widens and reads like its full-width self", () => {
  assert.equal(romanizeJapanese("ﾃｽﾄ"), "tesuto");
  assert.equal(romanizeJapanese("ｶﾞｷﾞｮｳ"), "gagyou");
  assert.equal(romanizeJapanese("ﾊﾟｰﾄﾞ"), "pādo");
  assert.equal(romanizeJapanese("ﾚｲﾝﾎﾞｰ"), "reinbō");
});

test("a word the dictionary has no reading for is read kanji by kanji, not left raw", () => {
  useJapanese({ tokenize: () => [{ surface_form: "夢現", reading: null, pos: "名詞" }] });
  assert.equal(romanizeJapaneseFull("夢現"), "mugen");
  useJapanese(null);
});

test("an auxiliary after a noun or a particle is a word of its own", () => {
  useJapanese({ tokenize: () => [
    { surface_form: "了解", reading: "リョウカイ", pos: "名詞" },
    { surface_form: "です", reading: "デス", pos: "助動詞" },
    { surface_form: "から", reading: "カラ", pos: "助詞" },
    { surface_form: "だ", reading: "ダ", pos: "助動詞" },
    { surface_form: "っけ", reading: "ッケ", pos: "助詞" },
    { surface_form: "食べ", reading: "タベ", pos: "動詞" },
    { surface_form: "たい", reading: "タイ", pos: "助動詞" },
  ] });
  assert.equal(romanizeJapaneseFull("x"), "ryoukai desu kara dakke tabetai");
  useJapanese(null);
});

test("a romanised run and a Latin word written together get a space", () => {
  assert.equal(romanizeMixed("まちでdancin'", "japanese"), "machide dancin'");
  assert.equal(romanizeMixed("Miku♪"), "Miku♪");
});

test("only the languages the user picked are romanised", () => {
  assert.equal(romanizeMixed("사랑해 カタカナ", null, ["ja"]), "사랑해 katakana");
  assert.equal(romanizeMixed("사랑해 カタカナ", null, ["ko"]), "saranghae カタカナ");
  assert.equal(romanizeMixed("사랑해", null, []), "사랑해");
  // Not told which: every language, as before.
  assert.equal(romanizeMixed("사랑해"), "saranghae");
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

test("a video never opens the card, and never closes one the user detached", () => {
  // A YouTube video or Short: something is loaded, but it is not a song. It
  // must not take away a card the user asked for by detaching it.
  const video = { playing: true, hasTrack: true, hasSong: false };
  assert.equal(auto({ ...video, up: true, waiting: false }), "stay");
  // Nor does it open one of its own.
  assert.equal(auto({ ...video, up: false }), "stay");
  // Paused on a video: still nothing to hide.
  assert.equal(auto({ ...video, playing: false, up: true }), "stay");
});

test("a stop is still a stop, even with the card up", () => {
  // Nothing loaded at all: the player closed, or released the session.
  assert.equal(auto({ up: true, hasTrack: false, hasSong: false }), "hide");
});

test("the switch in Settings is the master: off, nothing happens on its own", () => {
  assert.equal(auto({ enabled: false, playing: true, hasSong: true }), "stay");
  assert.equal(auto({ enabled: false, up: true }), "stay");
});

// ── Holding the words while a video owns the session ─────────────────────────
//
// One browser publishes one media session for all its tabs, so switching to a
// YouTube video while a song plays replaces the song's report with the video's.
// The pill keeps its words through a glance, but not through a film.

test("a glance at another tab keeps the words", () => {
  assert.equal(HOLD_MAX_MS, 20_000);
  const since = 1_000_000;
  assert.equal(holdStillUp(since, since), true);
  assert.equal(holdStillUp(since, since + 5_000), true);
  assert.equal(holdStillUp(since, since + 19_999), true);
});

test("watching a video takes the words away with the song", () => {
  const since = 1_000_000;
  // Past the grace period the lyrics go, even though the video is still playing
  // and nothing about the session says the song stopped.
  assert.equal(holdStillUp(since, since + 20_000), false);
  assert.equal(holdStillUp(since, since + 60_000), false);
  assert.equal(holdStillUp(since, since + 3_600_000), false);
});

test("a line before an unstamped instrumental break does not crawl through it", () => {
  // Four syllables every 4 s (1 s each), then 30 s of music with no blank stamp.
  const lines = parseLrc("[00:00]ba ba ba ba\n[00:04]da da da da\n[00:08]ka ka ka ka\n[00:12]ma ma ma ma\n[00:16]la la\n[00:46]end");
  // "la la" is two syllables at the song's pace × 1.2 slack: full after 2.4 s, not 30.
  assert.equal(sungFraction(lines, 4, 17.2), 0.5);
  assert.equal(sungFraction(lines, 4, 19), 1);
  // A line as long as its slot still fills until the next stamp.
  assert.equal(sungFraction(lines, 0, 2), 0.5);
});

test("syllables count kana, hangul and hanzi one each and Latin by vowel groups", () => {
  assert.equal(syllables("hello world"), 3);
  assert.equal(syllables("ゴーストルール"), 7);
  assert.equal(syllables("사랑해"), 3);
  assert.equal(syllables("!!"), 1);
});

test("NetEase's yrc gives lines timed word by word, credits left out", () => {
  const yrc = [
    '{"t":0,"c":[{"tx":"作词: "},{"tx":"DECO*27"}]}',
    "[0,1000](0,1000,0) 编曲 : DECO*27",
    "[9430,2000](9430,500,0)君(9930,500,0)の (10430,1000,0)声(yeah)",
  ].join("\n");
  const lines = parseYrc(yrc);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].at, 9.43);
  assert.equal(lines[0].text, "君の 声(yeah)");
  assert.deepEqual(lines[0].words.map((w) => w.size), [1, 1, 7]);
  // The wipe follows the words: two of nine letters once "の" is sung.
  assert.equal(sungFraction(lines, 0, 10.43), 2 / 9);
  assert.equal(sungFraction(lines, 0, 9.68), 0.5 / 9);
  assert.equal(sungFraction(lines, 0, 20), 1);
  // readSong prefers the word timing over the LRC.
  assert.equal(readSong("[00:01]other", null, yrc).timed[0].text, "君の 声(yeah)");
  assert.equal(readSong("[00:01]other", null, "").timed[0].text, "other");
});

test("a NetEase word with a music break folded in does not glow through the break", () => {
  // Ghost Rule's shape: a 9.3 s word over the intro, then the line sung.
  const [intro] = parseYrc("[9430,12930](9430,60,0)a(9490,9300,0)b(18790,220,0)c");
  assert.deepEqual(intro.words[1], { at: 17.79, end: 18.79, size: 1 });
  // Through the intro only the tiny first word is lit: b waits for the singing.
  assert.equal(sungFraction([intro], 0, 15), 1 / 3);
  // A line's last word holding over a break: sung at its start, then still.
  const [outro] = parseYrc("[0,12000](0,500,0)a(500,11000,0)b");
  assert.deepEqual(outro.words[1], { at: 0.5, end: 1.5, size: 1 });
  // A held note shorter than a break keeps its own slow fill.
  const [held] = parseYrc("[0,4500](0,500,0)a(500,4000,0)b(4500,200,0)c");
  assert.deepEqual(held.words[1], { at: 0.5, end: 4.5, size: 1 });
});

test("no takeover is no hold, and a clock that jumps back does not pin it", () => {
  assert.equal(holdStillUp(null, 1_000_000), false);
  // A suspend or a time change must not leave the pill up for ever.
  assert.equal(holdStillUp(1_000_000, 900_000), false);
});

test("the karaoke wipe fills a line until the next stamp, gaps included", () => {
  const lines = parseLrc("[00:10.00]one\n[00:14.00]\n[00:20.00]two");
  assert.equal(sungFraction(lines, 0, 9), 0);
  assert.equal(sungFraction(lines, 0, 12), 0.5);
  // The gap's stamp ends the line: it is full while the music plays.
  assert.equal(sungFraction(lines, 0, 16), 1);
  assert.equal(sungFraction(lines, 2, 25, 30), 0.5);
  // No duration for the last line: shown full rather than stuck empty.
  assert.equal(sungFraction(lines, 2, 21), 1);
  assert.equal(sungFraction([], 0, 5), 0);
});

test("an instrumental placeholder line is a gap, never words", () => {
  // NetEase's marker keeps its stamp as a gap, the way an LRC break is carried.
  const yrc = parseYrc("[10000,5000](10000,5000,0)纯音乐，请欣赏");
  assert.equal(yrc[0].text, "");
  assert.deepEqual(yrc[0].words, []);
  // The English word LRCLIB uses, and a lone note.
  assert.equal(parseLrc("[00:20](Instrumental)")[0].text, "");
  assert.equal(parseLrc("[00:20]♪")[0].text, "");
  assert.equal(parseLrc("[00:20]纯音乐，请欣赏")[0].text, "");
  // A line that only mentions the words is a lyric, not the marker.
  assert.equal(parseLrc("[00:20]純音楽のような曲")[0].text, "純音楽のような曲");
  assert.equal(parseLrc("[00:20]music is life")[0].text, "music is life");
});

test("an intro and a long interlude are instrumental, a short pause is not", () => {
  // A word-timed song: the intro's music folded into the first line's words,
  // two verses, a long break, and a last line singing to the end.
  const yrc = parseYrc([
    "[9430,12930](9430,60,0)a(9490,9300,0)b(18790,220,0)c",
    "[19010,2000](19010,1000,0)d(20010,1000,0)e",
    "[23010,2000](23010,2000,0)f",
    "[70000,2000](70000,1000,0)g(71000,1000,0)h",
  ].join("\n"));
  // Through the intro: the silence between the first word and the next is
  // longer than any pause in singing.
  assert.equal(instrumentalAt(yrc, Math.max(0, lineIndexAt(yrc, 15)), 15), true);
  // The voice has started: words again.
  assert.equal(instrumentalAt(yrc, Math.max(0, lineIndexAt(yrc, 18)), 18), false);
  // A pause of seconds between verses keeps the line on screen.
  assert.equal(instrumentalAt(yrc, Math.max(0, lineIndexAt(yrc, 22.5)), 22.5), false);
  // 47 s of music is an interlude, well past the voice.
  assert.equal(instrumentalAt(yrc, Math.max(0, lineIndexAt(yrc, 40)), 40), true);
  // The last line sings on to the end of the song.
  assert.equal(instrumentalAt(yrc, Math.max(0, lineIndexAt(yrc, 80)), 80), false);
  // A blank current line (a stamped gap nothing sings over) is instrumental.
  assert.equal(instrumentalAt(yrc, 9, 40), true);
});

test("a stamped break is music alone only deep into it", () => {
  const lrc = parseLrc("[00:10]one two\n[00:14]\n[00:40]three four\n[00:44]five");
  // Before the first stamp nothing is sung yet: an intro.
  assert.equal(instrumentalAt(lrc, Math.max(0, lineIndexAt(lrc, 5)), 5), true);
  // Singing.
  assert.equal(instrumentalAt(lrc, Math.max(0, lineIndexAt(lrc, 12)), 12), false);
  // Seconds past the voice is a pause between verses; the line stays.
  assert.equal(instrumentalAt(lrc, Math.max(0, lineIndexAt(lrc, 17)), 17), false);
  // Deep into the break it is music alone.
  assert.equal(instrumentalAt(lrc, Math.max(0, lineIndexAt(lrc, 25)), 25), true);
  // The last line sings on.
  assert.equal(instrumentalAt(lrc, Math.max(0, lineIndexAt(lrc, 60)), 60), false);
});

test("a break's span does not set the pace every line is sung at", () => {
  // Four syllables every 4 s, then 30 s of music, then normal lines: the
  // median pace comes from singing alone, not from the break.
  const lines = parseLrc("[00:00]ba ba ba ba\n[00:04]da da da da\n[00:08]ka ka ka ka\n[00:12]ma ma ma ma\n[00:16]la la\n[00:46]da da da da\n[00:50]end");
  assert.equal(sungFraction(lines, 4, 17.2), 0.5);
  assert.equal(sungFraction(lines, 4, 19), 1);
});
