// Every lyric line in a script the reader can follow. Japanese, Korean and
// Mandarin songs are sung in scripts most people cannot read at speed, so each
// line is shown romanised: kana → rōmaji (Hepburn), Hangul → Revised
// Romanization, Han → pinyin. A line already in Latin script is left alone, and
// so is the Latin part of a mixed line.
//
// The kana table and the Hangul rules are written here: the npm packages that
// do this either shout in capitals ("きょう" → "KYOU") or need a dictionary for
// the readings kanji would need anyway. What a lyric needs is lowercase rōmaji
// with the syllable rules right (っ doubles the next consonant, ー lengthens,
// ん becomes n before a consonant and n' before a vowel), which is a table.

// ── Script detection ──────────────────────────────────────────────────────────

const KANA = /[\u3040-\u309f\u30a0-\u30ff]/;
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/;
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

export type Script = "latin" | "kana" | "hangul" | "han";
/** kuromoji's token: `pos` is the part of speech (助詞 particle, 助動詞 auxiliary…). */
export type JapaneseToken = { surface_form: string; reading?: string | null; pos?: string; pos_detail_1?: string };
export type JapaneseTokenizer = { tokenize(text: string): JapaneseToken[] };

/** The script a line is mostly in. Kana wins over Han (a Japanese line has both). */
export function scriptOf(text: string): Script {
  if (KANA.test(text)) return "kana";
  if (HANGUL.test(text)) return "hangul";
  if (HAN.test(text)) return "han";
  return "latin";
}

/** The line as it should be read, or the line itself when it is already Latin. */
export function romanize(text: string): string {
  const script = scriptOf(text);
  if (script === "latin") return text;
  if (script === "kana") return japaneseReady() ? romanizeJapaneseFull(text) : romanizeJapanese(text);
  if (script === "hangul") return romanizeHangul(text);
  return romanizeChinese(text);
}

/**
 * A mixed line's non-Latin runs, romanised, with the Latin left as it is.
 * `Miku ♪ 私の心` → `Miku ♪ watashi no kokoro`.
 */
export function romanizeMixed(
  text: string,
  language: "japanese" | "chinese" | null = null,
  /** The languages to romanise ("ja", "ko", "zh"); every one when not given. */
  langs?: readonly string[],
): string {
  const wants = (code: string) => !langs || langs.includes(code);
  if (scriptOf(text) === "latin") return text;
  // Runs of Latin words and spacing stay; every other run is handed to the
  // script that matches it. The CJK run takes the symbols that live inside a
  // Japanese word or line too — 々 (散々), 、。「」 and the full-width ！？ — so
  // the dictionary sees 散々 whole rather than 散 alone.
  const runs = text.match(
    /[A-Za-z0-9'’.,!?…\-–—()\[\]{}"'«»:;\/&%$#@+*=~|\^_`<>]+|[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿！-ﾟᄀ-ᇿ㄰-㆏가-힣]+|\s+|[^\s]+/g,
  ) ?? [];
  let out = "";
  for (const run of runs) {
    let piece: string;
    const script = scriptOf(run);
    const japanese = script === "kana" || (script === "han" && language === "japanese");
    if (script === "latin") piece = run;
    else if (japanese && !wants("ja")) piece = run;
    else if (script === "hangul" && !wants("ko")) piece = run;
    else if (script === "han" && !japanese && !wants("zh")) piece = run;
    else if (japanese && language === "japanese") {
      piece = japaneseReady() ? romanizeJapaneseFull(run) : romanizeJapanese(run);
    } else piece = romanize(run);
    // 街でdancin' was written without a space; romanised, it needs one.
    if (/[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(piece)) out += " ";
    out += piece;
  }
  return out;
}

// ── Japanese: kana → rōmaji ───────────────────────────────────────────────────

/**
 * Hepburn, in the shape a lyric needs it: lowercase, long vowels as the kana
 * writes them (おう → ou, おお → oo), は as "wa" only where it is the particle
 * — which no table can know, so it stays "ha".
 */
const KANA_TABLE: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "i", ゑ: "e", を: "o", ん: "n",
  ゔ: "vu",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa",
  ゕ: "ka", ゖ: "ke",
  // The digraphs, longest first when matched.
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho", しぇ: "she",
  じゃ: "ja", じゅ: "ju", じょ: "jo", じぇ: "je",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho", ちぇ: "che",
  ぢゃ: "ja", ぢゅ: "ju", ぢょ: "jo",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo", ふゅ: "fyu",
  てぃ: "ti", てゅ: "tyu", でぃ: "di", でゅ: "dyu",
  とぅ: "tu", どぅ: "du",
  うぃ: "wi", うぇ: "we", うぉ: "wo",
  ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
  すぃ: "si", ずぃ: "zi",
  つぁ: "tsa", つぃ: "tsi", つぇ: "tse", つぉ: "tso",
};

/** Katakana → hiragana, so one table serves both. */
function katakanaToHiragana(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // ァ…ヶ (30A1–30F6) sit 0x60 above ぁ…ゖ.
    if (code >= 0x30a1 && code <= 0x30f6) out += String.fromCodePoint(code - 0x60);
    // ヴ (30F4) is ゔ; the small ka/ke too.
    else out += ch;
  }
  return out;
}

/** Katakana's vowel lengthener. A dash (— －) is punctuation in a lyric, not a held vowel. */
function isLongMark(ch: string): boolean {
  return ch === "ー";
}

/** Japanese punctuation as a Latin line writes it. */
const JA_PUNCT: Record<string, string> = {
  "、": ", ", "。": ". ", "，": ", ", "．": ". ", "！": "! ", "？": "? ",
  "「": " “", "」": "” ", "『": " “", "』": "” ", "（": " (", "）": ") ",
  "・": " ", "　": " ", "～": "~", "〜": "~",
};

function latinPunctuation(text: string): string {
  return text
    .replace(/[、。，．！？「」『』（）・　～〜]/g, (p) => JA_PUNCT[p])
    // Curly quotes tell an opening one from a closing one, so the space goes on the right side.
    .replace(/\s+([,.!?)”])(?=\s|$)/g, "$1")
    .replace(/([“(])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Vowels, for the long-vowel rule that follows ー. */
const VOWEL_OF: Record<string, string> = {
  a: "a", i: "i", u: "u", e: "e", o: "o",
};

export function romanizeJapanese(text: string): string {
  const hira = katakanaToHiragana(text);
  const chars = [...hira];
  let out = "";
  /** The vowel a bare ー lengthens: the last one pronounced. */
  let lastVowel = "";

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (isLongMark(ch)) {
      // ラーメン → rāmen: a macron on the vowel before, which is how a reader
      // expects a held vowel to look. No vowel before it: nothing to hold.
      if (lastVowel && out.endsWith(lastVowel)) out = out.slice(0, -1) + macron(lastVowel);
      continue;
    }
    // っ: the next consonant doubled.
    if (ch === "っ") {
      const next = chars[i + 1];
      const pair = next && (chars[i + 1] + (chars[i + 2] ?? ""));
      const romaji = (pair && KANA_TABLE[pair]) ?? (next ? KANA_TABLE[next] : undefined) ?? "";
      const first = romaji[0] ?? "";
      // Hepburn doubles ch as tch (まっちゃ → matcha).
      if (first === "c") out += "t";
      else if (first && !/^[aeiou]$/.test(first)) out += first;
      else if (romaji) out += "tsu";
      lastVowel = "";
      continue;
    }
    // ん: "n" before a consonant, "n'" before a vowel or y (しんいち → shin'ichi).
    if (ch === "ん") {
      const next = chars[i + 1];
      const pair = next ? chars[i + 1] + (chars[i + 2] ?? "") : "";
      const romaji = (pair && KANA_TABLE[pair]) ?? (next ? KANA_TABLE[next] : "") ?? "";
      out += romaji && /^[aeiouy]/.test(romaji) ? "n'" : "n";
      lastVowel = "";
      continue;
    }
    const pair = ch + (chars[i + 1] ?? "");
    if (KANA_TABLE[pair]) {
      const romaji = KANA_TABLE[pair];
      out += romaji;
      lastVowel = VOWEL_OF[romaji.at(-1) ?? ""] ?? "";
      i++;
      continue;
    }
    if (KANA_TABLE[ch]) {
      const romaji = KANA_TABLE[ch];
      out += romaji;
      lastVowel = VOWEL_OF[romaji.at(-1) ?? ""] ?? "";
      continue;
    }
    // Kanji or punctuation: kept as it is, and nothing is held past it.
    out += ch;
    lastVowel = "";
  }
  return latinPunctuation(out);
}

function macron(vowel: string): string {
  return { a: "ā", i: "ī", u: "ū", e: "ē", o: "ō" }[vowel] ?? vowel;
}

// ── Korean: Hangul → Revised Romanization ─────────────────────────────────────

const INITIAL = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const MEDIAL = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
/** A final consonant: its name alone, and its sound before a vowel. */
const FINAL: [string, string][] = [
  ["", ""], ["k", "g"], ["k", "kk"], ["k", "gs"], ["n", "n"], ["n", "nj"], ["n", "nh"], ["t", "d"],
  ["l", "r"], ["k", "lg"], ["m", "lm"], ["l", "lb"], ["l", "ls"], ["l", "lt"], ["l", "lp"], ["l", "lh"],
  ["m", "m"], ["p", "b"], ["p", "bs"], ["t", "s"], ["t", "ss"], ["ng", "ng"], ["t", "j"], ["t", "ch"],
  ["k", "k"], ["t", "t"], ["p", "p"], ["t", "h"],
];

/** A syllable's three letters, or null for anything that is not one. */
function jamo(ch: string | undefined): { ini: number; med: number; fin: number } | null {
  const code = ch ? (ch.codePointAt(0) ?? 0) : 0;
  if (code < 0xac00 || code > 0xd7a3) return null;
  // 한글 syllables: 0xAC00 + (initial × 21 + medial) × 28 + final
  const s = code - 0xac00;
  return { ini: Math.floor(s / 588), med: Math.floor((s % 588) / 28), fin: s % 28 };
}

const I_NG = 11, I_N = 2, I_M = 6, I_R = 5, I_H = 18, I_G = 0, I_D = 3, I_J = 12, M_I = 20;
const F_D = 7, F_T = 25, F_H = 27, F_NH = 6, F_LH = 15;
/** ㅎ after a final aspirates it: ㄱ→k, ㄷ→t, ㅂ→p, ㅈ→ch. */
const ASPIRATED: Record<string, string> = { k: "k", t: "t", p: "p" };
/** ㅎ as a final aspirates the next initial: ㄱ→k, ㄷ→t, ㅈ→ch. */
const ASPIRATE_INITIAL: Record<number, string> = { [I_G]: "k", [I_D]: "t", [I_J]: "ch" };

/**
 * How a final and the next initial are said together, as Revised Romanization
 * writes the sound: 합니다 → hamnida, 좋아 → joa, 같이 → gachi, 신라 → silla.
 * Returns [the final's letters, the next initial's letters].
 */
function boundary(fin: number, ini: number, med: number): [string, string] {
  const [plain, carried] = FINAL[fin];
  if (fin === 0) return ["", INITIAL[ini]];
  if (ini === I_NG) {
    // Liaison: the final moves to the empty initial — but a ㅎ falls silent,
    // and ㄷ/ㅌ before 이 palatalise.
    if (fin === F_H) return ["", ""];
    if (fin === F_NH) return ["", "n"];
    if (fin === F_LH) return ["", "r"];
    if (med === M_I && fin === F_D) return ["", "j"];
    if (med === M_I && fin === F_T) return ["", "ch"];
    if (fin === 21) return ["ng", ""];
    return ["", carried];
  }
  if (fin === F_H || fin === F_NH || fin === F_LH) {
    const rest = fin === F_NH ? "n" : fin === F_LH ? "l" : "";
    if (ASPIRATE_INITIAL[ini]) return [rest, ASPIRATE_INITIAL[ini]];
    if (ini === I_N) return [fin === F_LH ? "l" : "n", fin === F_LH ? "l" : "n"];
  }
  if (ini === I_H && ASPIRATED[plain]) return ["", ASPIRATED[plain]];
  if (ini === I_H && fin === 22) return ["", "ch"]; // ㅈ + ㅎ
  if (ini === I_N || ini === I_M) {
    // Nasalisation: k → ng, t → n, p → m before ㄴ/ㅁ; ㄹ + ㄴ → ll.
    if (plain === "k") return ["ng", INITIAL[ini]];
    if (plain === "t") return ["n", INITIAL[ini]];
    if (plain === "p") return ["m", INITIAL[ini]];
    if (plain === "l" && ini === I_N) return ["l", "l"];
  }
  if (ini === I_R) {
    if (plain === "l" || plain === "n") return ["l", "l"]; // 빨리 ppalli, 신라 silla
    if (plain === "m" || plain === "ng") return [plain, "n"]; // 종로 jongno
    if (plain === "k") return ["ng", "n"]; // 백리 baengni
    if (plain === "p") return ["m", "n"]; // 협력 hyeomnyeok
    if (plain === "t") return ["n", "n"];
  }
  return [plain, INITIAL[ini]];
}

/**
 * Revised Romanization, lowercase like the Japanese, with the sound changes
 * across a syllable boundary inside a word (none across a space).
 */
export function romanizeHangul(text: string): string {
  let out = "";
  const chars = [...text];
  /** The initial already decided by the boundary before this syllable. */
  let carriedInitial: string | null = null;
  for (let i = 0; i < chars.length; i++) {
    const s = jamo(chars[i]);
    if (!s) {
      out += chars[i];
      carriedInitial = null;
      continue;
    }
    const next = jamo(chars[i + 1]);
    const [finalLetters, nextInitial] = next ? boundary(s.fin, next.ini, next.med) : [FINAL[s.fin][0], null];
    out += (carriedInitial ?? INITIAL[s.ini]) + MEDIAL[s.med] + finalLetters;
    carriedInitial = nextInitial;
  }
  return out;
}

// ── Japanese dictionary readings ───────────────────────────────────────────────

let japaneseTokenizer: JapaneseTokenizer | null = null;

/** The particles a dictionary reads as written but a singer says otherwise. */
const PARTICLE: Record<string, string> = { は: "wa", へ: "e", を: "o" };

/**
 * Whether a token belongs to the word before it rather than starting one:
 * auxiliaries (たい, ます, た), the て/で/ば that join a verb, a verb or noun
 * suffix. 食べ|たい → "tabetai", 待っ|て → "matte" (the っ needs the て).
 */
function joinsPrevious(token: JapaneseToken, previous: string | undefined): boolean {
  // An auxiliary ends a verb or an adjective (食べ|たい, 見|た); after a noun or
  // a particle it is a word of its own (了解 です, から だっけ, きれい だ).
  if (token.pos === "助動詞") return previous === "動詞" || previous === "形容詞" || previous === "助動詞";
  if (token.pos === "助詞" && token.pos_detail_1 === "接続助詞" && /^[てでば]$/.test(token.surface_form)) return true;
  if ((token.pos === "動詞" || token.pos === "形容詞") &&
      (token.pos_detail_1 === "接尾" || token.pos_detail_1 === "非自立")) return true;
  // A noun suffix (さん, たち) joins; a dependent noun (もの, こと) is a word of its own.
  return token.pos === "名詞" && token.pos_detail_1 === "接尾";
}

/**
 * Lyric spellings the dictionary (IPADIC) has no reading for, written out as
 * the song says them: 燦き is sung "kirameki", 揺蕩う "tayutau".
 */
const MISSING_WORDS: [RegExp, string][] = [
  [/[燦煌](?:めき|き)/g, "きらめき"],
  [/[燦煌](?:めく|く)/g, "きらめく"],
  [/揺蕩/g, "たゆた"],
  [/混絡が/g, "こんがらが"],
  // The dictionary splits these into number + counter (ni-nin, ichi-nin); a
  // song says them as one word.
  [/二人/g, "ふたり"],
  [/一人/g, "ひとり"],
  [/燈/g, "灯"],
];
/** A kanji left on its own with no reading: its on'yomi, rather than the kanji in a Latin line. */
const MISSING_KANJI: Record<string, string> = { 燦: "さん", 煌: "こう", 蕩: "とう" };

/** Japanese kanji → reading-backed rōmaji, a space between words. Without a tokenizer, keep the source. */
export function romanizeJapaneseFull(text: string): string {
  if (!japaneseTokenizer) return text;
  // Tokens are grouped into words first and each word romanised whole, so a
  // っ at the end of one token still doubles the consonant of the next.
  const words: string[][] = [];
  // 々 repeats the kanji before it. The dictionary reads 日々 and 散々 in
  // context, but now and then cuts a 々 off on its own (時 + 々): only then is
  // the word written out (時時), which it always knows.
  const known = MISSING_WORDS.reduce((line, [spelling, reading]) => line.replace(spelling, reading), text);
  let tokens = japaneseTokenizer.tokenize(known);
  if (tokens.some((t) => t.surface_form.startsWith("々"))) {
    tokens = japaneseTokenizer.tokenize(known.replace(/(\p{Script=Han})々/gu, "$1$1"));
  }
  let previous: string | undefined;
  for (const token of tokens) {
    const surface = token.surface_form;
    if (/^\s+$/.test(surface)) { words.push([" "]); continue; }
    let reading: string;
    if (token.pos === "助詞" && PARTICLE[surface]) reading = PARTICLE[surface];
    else if (token.reading && token.reading !== "*") reading = katakanaToHiragana(token.reading);
    // Unknown word: kana still romanises; a kanji the table knows gets its on'yomi.
    else reading = [...surface].map((ch) => MISSING_KANJI[ch] ?? ch).join("");
    const last = words.at(-1);
    if (last && last[0] !== " " && (joinsPrevious(token, previous) || last.at(-1)?.endsWith("っ") || reading.startsWith("っ"))) last.push(reading);
    else words.push([reading]);
    previous = token.pos;
  }
  return latinPunctuation(words.map((w) => (w[0] === " " ? "" : romanizeJapanese(w.join("")))).join(" "));
}

export function useJapanese(tokenizer: JapaneseTokenizer | null) {
  japaneseTokenizer = tokenizer;
}

export function japaneseReady(): boolean {
  return japaneseTokenizer != null;
}

/** The language a whole song is in, from its lines: one kanji-only line does
 *  not decide it. Kana outweighing Han means Japanese; Han alone means Chinese. */
export function languageOfLines(lines: string[]): "japanese" | "chinese" | null {
  let kana = 0;
  let han = 0;
  for (const line of lines) {
    if (KANA.test(line)) kana++;
    else if (HAN.test(line)) han++;
  }
  return kana > han ? "japanese" : han > 0 ? "chinese" : null;
}

let japaneseLoad: Promise<boolean> | null = null;

/**
 * Builds the tokenizer once, from the dictionary Vite copies to /dict/. A
 * failure is remembered: the page keeps the kanji as written rather than
 * asking again on every song. Never rejects.
 */
export function ensureJapaneseTokenizer(): Promise<boolean> {
  if (japaneseTokenizer) return Promise.resolve(true);
  if (japaneseLoad) return japaneseLoad;
  japaneseLoad = (async () => {
    try {
      const mod = await import("@sglkc/kuromoji");
      const tokenizer = await new Promise<JapaneseTokenizer>((resolve, reject) => {
        mod.builder({ dicPath: "/dict/" }).build((err: Error | null, built: JapaneseTokenizer) =>
          err ? reject(err) : resolve(built),
        );
      });
      japaneseTokenizer = tokenizer;
      return true;
    } catch {
      // Without the dictionary Japanese lines show as written: readable, just
      // not romanised. Nothing here may break the card.
      return false;
    }
  })();
  return japaneseLoad;
}

// ── Chinese: Han → pinyin ─────────────────────────────────────────────────────

let pinyinOf: ((text: string, options: Record<string, unknown>) => string) | null = null;

/**
 * Han → pinyin without tone marks (`月亮` → `yueliang`): a line sung in a
 * language with tones that has no room for them. Loaded on the first Chinese
 * line, so a library of Western songs never pays for it.
 */
export function romanizeChinese(text: string): string {
  if (!pinyinOf) return text;
  const out = pinyinOf(text, { toneType: "none", type: "string", nonZh: "consecutive", v: true });
  return out.replace(/\s+/g, " ").trim();
}

/** Wires the pinyin library once its chunk has arrived. */
export function usePinyin(fn: (text: string, options: Record<string, unknown>) => string) {
  pinyinOf = fn;
}

/** Whether pinyin is ready (it is loaded when a Chinese line first appears). */
export function pinyinReady(): boolean {
  return pinyinOf != null;
}
