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
export function readSong(synced: string | null | undefined, plain: string | null | undefined): Song {
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
    for (const at of stamps) {
      out.push({ at: Math.max(0, at + offset), text: sung });
    }
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

/**
 * The line being sung at `seconds`: the last one that has started. -1 before
 * the first. Two lines stamped the same instant count as one.
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
  return found;
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
