// The words of a track, from LRCLIB through the app (lyrics.rs), and kept in
// localStorage so the same song twice costs nothing the second time.
//
// Two caches: the lyrics themselves, by artist + title + length, and the tracks
// LRCLIB had nothing for, so a missing song is not asked about again and again
// on every play. Both are trimmed: a lyrics entry is a few KB and the store is
// a few MB, but a library played for months would find its way out of it.

import { Bridge } from "../core/bridge";
import { cacheKey, readSong, type Song } from "./lrc";

// v3: the asker learned to look inside a wrapped title (『鳴潮』…「Unwritten in
// the Stars」) and to read NetEase's aliases, so songs stored as missing in the
// days of the blunt question would stay missing for a week. The old entries are
// dropped once.
const KEY = "miku.lyrics.cache.v3";
const MISS_KEY = "miku.lyrics.misses.v3";
try {
  globalThis.localStorage?.removeItem("miku.lyrics.cache");
  globalThis.localStorage?.removeItem("miku.lyrics.misses");
  globalThis.localStorage?.removeItem("miku.lyrics.cache.v2");
  globalThis.localStorage?.removeItem("miku.lyrics.misses.v2");
} catch {
  // Storage refused: nothing old to drop.
}
/** Songs kept: about a long album, which is more than a night of listening. */
const MAX_SONGS = 200;
const MAX_MISSES = 300;
/** Longer than any lyric's needs; a song is a few KB of text. */
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Entry {
  /** The LRC text, when LRCLIB had timing for it. */
  synced: string | null;
  /** The words without timing. */
  plain: string | null;
  /** NetEase's word-timed lines (yrc), when it had them. */
  words?: string | null;
  /** When it was stored, so the oldest go first. */
  at: number;
}

type Store = Record<string, Entry>;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or refused: the next play asks again, which is only slow.
  }
}

/** The parsed stores, kept in memory: a lookup used to re-parse the whole
 *  blob (a few MB at the cap) on every song. Writes go straight through; a
 *  storage event — another window's write, such as Settings clearing the
 *  cache on a source change — drops the copy so the change is seen at once. */
let store: Store | null = null;
let misses: Misses | null = null;
globalThis.addEventListener?.("storage", (e) => {
  const ev = e as StorageEvent;
  if (ev.key === KEY) store = null;
  if (ev.key === MISS_KEY) misses = null;
});

/** The songs remembered, newest last, trimmed to MAX_SONGS. */
function loadStore(): Store {
  if (!store) {
    store = read<Store>(KEY, {});
    const keys = Object.keys(store);
    if (keys.length > MAX_SONGS) {
      keys.sort((a, b) => (store![a].at ?? 0) - (store![b].at ?? 0));
      const trimmed: Store = {};
      for (const k of keys.slice(-MAX_SONGS)) trimmed[k] = store![k];
      store = trimmed;
    }
  }
  return store;
}

/** The songs LRCLIB had nothing for, by cache key, with when we looked. */
type Misses = Record<string, number>;

function missed(key: string): boolean {
  misses ??= read<Misses>(MISS_KEY, {});
  const at = misses[key];
  return typeof at === "number" && Date.now() - at < MISS_TTL_MS;
}

function rememberMiss(key: string) {
  misses ??= read<Misses>(MISS_KEY, {});
  misses[key] = Date.now();
  const keys = Object.keys(misses);
  if (keys.length > MAX_MISSES) {
    keys.sort((a, b) => misses![a] - misses![b]);
    for (const k of keys.slice(0, keys.length - MAX_MISSES)) delete misses![k];
  }
  write(MISS_KEY, misses);
}

/** A song already known, without asking anybody. */
export function cachedSong(track: { artist: string; title: string; duration: number }): Song | null {
  const entry = loadStore()[cacheKey(track)];
  if (!entry) return null;
  const song = readSong(entry.synced, entry.plain, entry.words);
  return song.timed.length || song.plain.length ? song : null;
}

/** Whether this track was asked about recently and had no words. */
export function knownMissing(track: { artist: string; title: string; duration: number }): boolean {
  return missed(cacheKey(track));
}

/**
 * The words of `track`, from the cache or from LRCLIB. Resolves with an empty
 * song when there are none — a track LRCLIB does not know is ordinary, not an
 * error — and only rejects when the app itself could not be reached.
 */
export async function fetchSong(track: {
  artist: string;
  title: string;
  album: string;
  duration: number;
}): Promise<Song> {
  const hit = cachedSong(track);
  if (hit) return hit;
  const key = cacheKey(track);
  if (missed(key)) return { timed: [], plain: [] };
  if (!track.title.trim()) return { timed: [], plain: [] };

  // The whole credit line, not just its first name: Rust needs it to tell a
  // record that names this very song from one by a cover artist, and a duet's
  // credit is the artist plus their guests.
  const res = await Bridge.lyricsFetch(track.artist, track.title, track.album, track.duration);
  // `null` is both "no window to answer" and "nothing found": either way, no words.
  const song = readSong(res?.synced, res?.plain, res?.words);
  if (!song.timed.length && !song.plain.length) {
    // The service being busy is not the same as the song having no words: only
    // a real "no such track" is worth remembering, or a busy minute would hide
    // this song for a week.
    if (!res?.busy) rememberMiss(key);
    return song;
  }
  const store = loadStore();
  store[key] = { synced: res?.synced ?? null, plain: res?.plain ?? null, words: res?.words ?? null, at: Date.now() };
  write(KEY, store);
  return song;
}

/** Forgets everything: a change of source in Settings asks every song again. */
export function clearCache() {
  store = {};
  misses = {};
  write(KEY, {});
  write(MISS_KEY, {});
}
