// What the overlay shows of a song: its words, timed. LRCLIB hands them over as
// LRC (`[mm:ss.xx] text`) or, for many tracks, as plain untimed text; here they
// become one sorted list of lines whether they were timed or not.
//
// A file is a list of timed lines, a few header tags (`[ar:…]`, `[offset:…]`),
// and often several timestamps on one line for a repeated chorus. A line with
// no timing at all (plain lyrics) gets no time: the overlay then shows it as a
// block, scrolled by nothing.

export interface LyricsLine {
  /** Seconds from the start of the track. */
  at: number;
  text: string;
  /** Each word's own time, when the source has it (NetEase's yrc). */
  words?: Word[];
}

/** One word of a word-timed line: when it is sung, and how much of the line it is. */
export interface Word {
  at: number;
  end: number;
  /** Its letters, spaces left out: the share of the wipe it takes. */
  size: number;
}

export interface Song {
  /** Timed lines, in time order. Empty for plain lyrics. */
  timed: LyricsLine[];
  /** Untimed lines, when there is no timing at all. */
  plain: string[];
}

export const EMPTY_SONG: Song = { timed: [], plain: [] };

const TAG = /^\[(ar|al|ti|au|by|re|ve|length|offset|tool):(.*)\]$/i;
const STAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

/**
 * The song in `synced` (LRC) when it has any timing, else `plain` split into
 * lines. Empty for a track with no words at all.
 */
export function readSong(synced: string | null | undefined, plain: string | null | undefined, words?: string | null): Song {
  const byWord = parseYrc(words ?? "");
  if (byWord.length) return { timed: byWord, plain: [] };
  const timed = parseLrc(synced ?? "");
  if (timed.length) return { timed, plain: [] };
  const lines = (plain ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return { timed: [], plain: lines };
}

/** Every timed line of an LRC file, earliest first. */
export function parseLrc(text: string): LyricsLine[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  // The offset is a header tag that applies to the whole file, wherever it
  // sits, so it is read before any line is placed.
  let offset = 0;
  for (const line of lines) {
    const tag = line.match(TAG);
    // A positive offset delays every line, in milliseconds.
    if (tag && tag[1].toLowerCase() === "offset") {
      const ms = Number(tag[2].trim());
      if (Number.isFinite(ms)) offset = ms / 1000;
    }
  }

  const out: LyricsLine[] = [];
  for (const line of lines) {
    if (TAG.test(line)) continue;
    const stamps: number[] = [];
    let words = line;
    for (const m of line.matchAll(STAMP)) {
      const min = Number(m[1]);
      const sec = Number(m[2].replace(":", "."));
      if (!Number.isFinite(min) || !Number.isFinite(sec)) continue;
      stamps.push(min * 60 + sec);
      // Everything after the last stamp is the words.
      words = line.slice((m.index ?? 0) + m[0].length);
    }
  if (!stamps.length) continue;
  const sung = words.trim();
  // A karaoke file stamps "instrumental, please enjoy" over a break: it marks
  // the music, so it stays as a stamped gap, never as words to sing.
  const text = INSTRUMENTAL.test(sung) ? "" : sung;
  for (const at of stamps) {
    out.push({ at: Math.max(0, at + offset), text });
  }
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

/** NetEase's credit lines ("作词 : …", "编曲 : …"): who wrote it, not words to sing. */
const CREDIT = /^\s*(作词|作詞|作曲|编曲|編曲|制作|製作|监制|混音|录音|母带|和声|吉他|贝斯|鼓|弦乐|出品|发行|OP|SP|lyricist|lyrics|composer|arranger|producer)[^:：]{0,8}[:：]/i;
/** The "instrumental, please enjoy" a karaoke source stamps over a break:
 *  NetEase's 纯音乐, a lone note, LRCLIB's own word. A whole line of it marks
 *  the music, never words to sing. */
const INSTRUMENTAL = /^(?:\(?instrumental\)?|纯音乐[，,、\s]*(?:请欣赏)?|純音楽|[♪♫♩♬]+)$/i;
const YRC_LINE = /^\[(\d+),(\d+)\](.*)$/;
const YRC_WORD = /\((\d+),(\d+),-?\d+\)/;
/** Longer than a held note, in seconds: such a word has a break folded in. */
const BREAK_S = 5;
/** How long a word with a break folded in is given to be sung. */
const SUNG_S = 1;
/** Past a line's voice by this much, the music is an interlude, not a pause
 *  between verses. */
const INTERLUDE_S = 5;
/** A span longer than this between two stamps is a break: it never sets the
 *  pace every line is sung at. */
const PACE_SPAN_S = 15;

/**
 * NetEase's word-timed lyrics: `[lineMs,durMs](wordMs,durMs,0)word(…)word`,
 * one line each, with JSON lines for the credits. Empty when there is none.
 */
export function parseYrc(text: string): LyricsLine[] {
  const out: LyricsLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.match(YRC_LINE);
    if (!line) continue;
    // split() with groups: [before, at, dur, word, at, dur, word, …]. A word
    // may hold "(" itself, so it is cut on the time stamps, not on brackets.
    const parts = line[3].split(YRC_WORD);
    const words: Word[] = [];
    let sung = "";
    for (let i = 1; i + 2 < parts.length; i += 3) {
      const at = Number(parts[i]) / 1000;
      const end = at + Number(parts[i + 1]) / 1000;
      const word = parts[i + 2];
      sung += word;
      words.push({ at, end, size: word.replace(/\s/g, "").length });
    }
    const textOf = sung.trim();
    if (!textOf || CREDIT.test(textOf)) continue;
    // The instrumental placeholder keeps its stamp as a gap, the way an LRC
    // break is carried: it holds the break's place in time, saying nothing.
    if (INSTRUMENTAL.test(textOf)) {
      out.push({ at: Number(line[1]) / 1000, text: "", words: [] });
      continue;
    }
    // NetEase sometimes folds an instrumental break into one word ("ゴ" held
    // for 9 s through an intro), which made it glow slowly over the music. A
    // word longer than any held note is mostly music: with words after it the
    // break came first, so it is sung at its end; ending the line, the break
    // comes after, so it is sung at its start.
    let last = words.length - 1;
    while (last > 0 && words[last].size === 0) last--;
    words.forEach((w, k) => {
      if (w.end - w.at <= BREAK_S) return;
      if (k < last) w.at = w.end - SUNG_S;
      else w.end = w.at + SUNG_S;
    });
    out.push({ at: Number(line[1]) / 1000, text: textOf, words });
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

/**
 * The line being sung at `seconds`: the last one that has started. -1 before
 * the first. Two lines stamped the same instant count as one.
 *
 * A stamped line with no words is a gap, not a line: LRCLIB's LRC files carry
 * them for instrumental breaks ("[00:04.29] "). Returning that index left the
 * card showing a title and no words at all for the length of the gap, which is
 * what a song's intro and middle look like. The scan therefore keeps the most
 * recent line that has words, so a gap holds the line before it.
 */
export function lineIndexAt(lines: readonly LyricsLine[], seconds: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].at <= seconds) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Walk back over any gap to the last line with words. The walk is bounded by
  // the number of consecutive blank stamps, which is a handful in any real file.
  for (let i = found; i >= 0; i--) {
    if (lines[i].text.trim()) return i;
  }
  return found;
}

/**
 * How much of line `index` is sung at `seconds`, 0 to 1: the karaoke wipe.
 *
 * A word-timed line (NetEase) fills word by word, each word over its own time.
 * A line-timed one (LRCLIB) only has its start: it fills evenly until the next
 * stamp (a gap's stamp included), the last line until `duration`. An LRC with
 * no blank stamp for an instrumental break would then crawl through the music,
 * so the line is also given the time its syllables take at the song's own
 * pace, and is full once that is over.
 */
export function sungFraction(lines: readonly LyricsLine[], index: number, seconds: number, duration = 0): number {
  const line = lines[index];
  if (!line) return 0;
  const byWord = wordFraction(line, seconds);
  if (byWord != null) return byWord;
  const start = line.at;
  const end = lineEnd(lines, index, duration);
  if (!(end > start)) return 1;
  return Math.min(1, Math.max(0, (seconds - start) / (end - start)));
}

/**
 * When a line-timed line is sung until: the next stamp (a gap's included) or
 * the song's end, shortened to the time its syllables take at the song's own
 * pace — so a line does not crawl through an unstamped break.
 */
function lineEnd(lines: readonly LyricsLine[], index: number, duration: number): number {
  const line = lines[index];
  const start = line.at;
  let end = lines[index + 1]?.at ?? duration;
  const pace = songPace(lines);
  if (pace > 0) end = Math.min(end, start + Math.max(1, syllables(line.text) * pace * 1.2));
  return end > start ? end : start;
}

/**
 * Whether `seconds` sits in music with no voice: before the line's singing
 * starts, on a line without words (a song opened by a stamped gap), or well
 * past the line's voice — a long interlude, not the pause between verses.
 * The card shows a note there, not a line that sings nothing.
 */
export function instrumentalAt(lines: readonly LyricsLine[], index: number, seconds: number, duration = 0): boolean {
  const line = lines[index];
  if (!line?.text.trim()) return true;
  const words = line.words;
  let voiceEnd: number;
  if (words?.length) {
    // A word-timed line sings from its first word to its last: NetEase folds
    // an intro's music into a line's first words, so the words, not the line
    // stamp, say when the voice starts.
    if (seconds < words[0].at) return true;
    for (let k = 0; k + 1 < words.length; k++) {
      if (seconds <= words[k].end) return false;
      if (seconds < words[k + 1].at) {
        // A long silence between two words is that music, showing through.
        return words[k + 1].at - words[k].end > INTERLUDE_S;
      }
    }
    if (seconds <= words[words.length - 1].end) return false;
    voiceEnd = words[words.length - 1].end;
  } else {
    if (seconds < line.at) return true;
    voiceEnd = lineEnd(lines, index, duration);
    if (seconds <= voiceEnd) return false;
  }
  // Past the voice. The last line sings on to the end of the song.
  if (nextSungLine(lines, index) < 0) return false;
  return seconds - voiceEnd > INTERLUDE_S;
}

function wordFraction(line: LyricsLine, seconds: number): number | null {
  const words = line.words;
  if (!words?.length) return null;
  const total = words.reduce((n, w) => n + w.size, 0);
  if (!total) return null;
  let done = 0;
  for (const w of words) {
    if (seconds >= w.end) {
      done += w.size;
      continue;
    }
    if (seconds > w.at && w.end > w.at) done += (w.size * (seconds - w.at)) / (w.end - w.at);
    break;
  }
  return Math.min(1, done / total);
}

/**
 * About how many syllables a line has: one per Japanese, Chinese or Korean
 * character, one per vowel group in Latin words. Never 0.
 */
export function syllables(text: string): number {
  const cjk = text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]/g)?.length ?? 0;
  const latin = text.match(/[aeiouyà-ÿ]+/gi)?.length ?? 0;
  return Math.max(1, cjk + latin);
}

const paceCache = new WeakMap<readonly LyricsLine[], number>();

/** Seconds per syllable this song is sung at (the median over its lines); 0 with too few lines to tell. */
function songPace(lines: readonly LyricsLine[]): number {
  let pace = paceCache.get(lines);
  if (pace === undefined) {
    const rates: number[] = [];
    for (let i = 0; i + 1 < lines.length; i++) {
      const d = lines[i + 1].at - lines[i].at;
      // A break's span would inflate the pace and let every line crawl:
      // only singing distances set the pace.
      if (lines[i].text.trim() && d > 0 && d < PACE_SPAN_S) rates.push(d / syllables(lines[i].text));
    }
    rates.sort((a, b) => a - b);
    pace = rates.length >= 4 ? rates[rates.length >> 1] : 0;
    paceCache.set(lines, pace);
  }
  return pace;
}

/**
 * The next line with words after `index`, or -1. Gaps sit between verses, so
 * the line shown as "next" has to skip over them the same way lineIndexAt does.
 */
export function nextSungLine(lines: readonly LyricsLine[], index: number): number {
  for (let i = index + 1; i < lines.length; i++) {
    if (lines[i].text.trim()) return i;
  }
  return -1;
}

/**
 * The last line with words before `index`, or -1. The backwards twin of
 * nextSungLine, for the line shown above the one being sung.
 */
export function previousSungLine(lines: readonly LyricsLine[], index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    if (lines[i].text.trim()) return i;
  }
  return -1;
}

/**
 * The artist's first name only: "A feat. B" matches far more recordings.
 *
 * Only a guest is cut off, never a comma or an "&": "Simon & Garfunkel" is one
 * artist, and cutting at the & would file their songs and Simon's solo work
 * under the same name.
 */
export function mainArtist(artist: string): string {
  const credit = (artist || "").trim();
  // A guest comes after "feat.", "ft." or "featuring": cut there first, so the
  // names of the main act that come before it stay.
  const guest = credit.search(/\s(?:feat|ft|featuring)\.?\s/i);
  if (guest > 0) return credit.slice(0, guest).trim().replace(/,$/, "");
  return credit;
}

/**
 * The song a track is: what LRCLIB is asked for, and the key its words are
 * cached under.
 */
export function cacheKey(track: { artist: string; title: string; duration: number }): string {
  // The whole credit line is the key: two artists on one song are their own
  // entry, and a guest singer does not move it to the first artist's.
  const artist = (track.artist || "").trim().toLowerCase();
  const title = (track.title || "").trim().toLowerCase();
  return [artist, title, String(Math.round(track.duration || 0))].join("|");
}
