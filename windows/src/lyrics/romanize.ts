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
  if (script === "kana") return romanizeJapanese(text);
  if (script === "hangul") return romanizeHangul(text);
  return romanizeChinese(text);
}

/**
 * A mixed line's non-Latin runs, romanised, with the Latin left as it is.
 * `Kanon ♪ 私の心` → `Kanon ♪ watashi no kokoro`.
 */
export function romanizeMixed(text: string): string {
  if (scriptOf(text) === "latin") return text;
  // Runs of Latin words and spacing stay; every other run is handed to the
  // script that matches it.
  return text.replace(
    /([A-Za-z0-9'’.,!?…\-–—()\[\]{}"'«»:;\/&%$#@+*=~|\\^_`<>]+|[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]+|\s+|[^\s]+)/g,
    (run) => (scriptOf(run) === "latin" ? run : romanize(run)),
  );
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

/** Katakana's vowel lengthener ー sits above the same offset; keep it as a mark. */
function isLongMark(ch: string): boolean {
  return ch === "ー" || ch === "－" || ch === "—";
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
      if (first && !/^[aeiou]$/.test(first)) out += first;
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
  return out.replace(/\s+/g, " ").trim();
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

/**
 * Revised Romanization, syllable by syllable. Its assimilation rules across a
 * syllable boundary (합니다 → hamnida, not hapnida) need the sounds, which the
 * two letters of a final give: the rules written out here would be a table as
 * long as the alphabet for very little a reader notices in a lyric.
 */
export function romanizeHangul(text: string): string {
  let out = "";
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].codePointAt(0) ?? 0;
    // 한글 syllables: 0xAC00 + (initial × 21 + medial) × 28 + final
    if (code >= 0xac00 && code <= 0xd7a3) {
      const s = code - 0xac00;
      const ini = Math.floor(s / 588);
      const med = Math.floor((s % 588) / 28);
      const fin = s % 28;
      // The final carries over to the next syllable when that syllable starts
      // with ㅇ, the silent initial: 있어 → isseo, 한국어 → hangugeo.
      const next = chars[i + 1];
      const nextCode = next ? (next.codePointAt(0) ?? 0) : 0;
      const takesOver =
        nextCode >= 0xac00 && nextCode <= 0xd7a3 && Math.floor((nextCode - 0xac00) / 588) === 11;
      out += INITIAL[ini] + MEDIAL[med] + FINAL[fin][takesOver ? 1 : 0];
    } else {
      out += chars[i];
    }
  }
  // A capital to start a line, as any Latin text has: romanised Korean reads
  // as prose, and a line in all lowercase looks like a mistake.
  return out.replace(/^\s*([a-z])/, (_m, c: string) => c.toUpperCase());
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
