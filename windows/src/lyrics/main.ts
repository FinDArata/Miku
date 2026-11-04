// The floating lyrics overlay (lyrics.html) — MiniLyrics' idea, on Windows and
// Linux: a small always-on-top card that follows what Spotify plays and shows
// the line being sung, with the one before and the one after.
//
// The player reaches this page the same way it reaches the island: the `spotify`
// event carries the state, `positionAt` says when its clock was read, and
// spotifyPosition() runs it forward. The words come from LRCLIB through
// lyrics_fetch (the page cannot reach the network: the app's CSP forbids it),
// and are romanised so a Japanese, Korean or Mandarin line can be read as it is
// sung.
//
// Nothing runs while the window is hidden, and the clock only ticks while a
// song plays: an overlay nobody is looking at costs nothing.

import "./lyrics.css";
import { Bridge, onEvent, type LyricsPrefs } from "../core/bridge";
import { Spotify, isAd, spotifyPosition, type SpotifyState } from "../core/spotify";
import type { Settings } from "../core/state";
import { t } from "../i18n/i18n";
import { cachedSong, fetchSong, knownMissing } from "./fetch";
import { lineIndexAt, type Song } from "./lrc";
import { pinyinReady, romanizeMixed, scriptOf, usePinyin } from "./romanize";
import { DEFAULT_PREFS, prefsFrom } from "./state";

/** How often the line is re-read inside a song, in ms: a line lasts seconds. */
const TICK_MS = 200;
/** Lines shown around the current one, above and below. */
const NEIGHBOURS = 1;

const rowsEl = document.getElementById("rows")!;
const songEl = document.getElementById("song")!;

const prefs: LyricsPrefs = { ...DEFAULT_PREFS };
const EMPTY: Song = { timed: [], plain: [] };
let song: Song = EMPTY;
/** The track the words in `song` belong to, as the page tells tracks apart. */
let songFor = "";
let loading = false;
/** Bumped for every track: an answer that arrives for an older one is dropped. */
let generation = 0;
let playing = false;
/** The sung line last drawn, so a change of line can be animated and a
 *  redraw with nothing new can be skipped. */
let shownIndex = Number.NaN;
let ticker: number | null = null;
/** Whether this window is up at all. */
let up = false;

// ── The words ─────────────────────────────────────────────────────────────────

/** What two reports of a track are the same by. */
export function trackKey(track: { artist: string; title: string; duration: number }): string {
  return [track.artist, track.title, String(Math.round(track.duration))].join("\u0000");
}

/** Forgets the drawn line: the next frame draws from the top. */
function reset() {
  song = EMPTY;
  songFor = "";
  shownIndex = Number.NaN;
}

/** The song for the track now playing, from memory or from LRCLIB. */
async function syncSong() {
  const track = Spotify.state.track;
  if (!track || isAd(track)) {
    reset();
    draw();
    return;
  }
  const key = trackKey(track);
  // Already this song: nothing to ask anybody.
  if (key === songFor) return;

  const known = cachedSong(track);
  if (known || knownMissing(track)) {
    generation++;
    loading = false;
    song = known ?? EMPTY;
    songFor = key;
    shownIndex = Number.NaN;
    draw();
    if (song.timed.length || song.plain.length) void ensurePinyin();
    return;
  }

  const mine = ++generation;
  loading = true;
  song = EMPTY;
  songFor = key;
  shownIndex = Number.NaN;
  draw();
  const answer = await fetchSong(track);
  // Another song started while we were waiting.
  if (mine !== generation) return;
  loading = false;
  song = answer;
  draw();
  if (song.timed.length || song.plain.length) void ensurePinyin();
}

// ── Pinyin, when a line needs it ─────────────────────────────────────────────

let pinyinAsked = false;

/** Loads the pinyin library the first time a Chinese line is there to show. */
async function ensurePinyin() {
  if (pinyinReady() || pinyinAsked) return;
  const lines = [...song.timed.map((l) => l.text), ...song.plain];
  if (!lines.some((line) => scriptOf(line) === "han")) return;
  pinyinAsked = true;
  try {
    const mod = await import("pinyin-pro");
    usePinyin(mod.pinyin);
    shownIndex = Number.NaN;
    draw();
  } catch {
    // Without it, Chinese lines show as written: readable, just not romanised.
  }
}

// ── Drawing ──────────────────────────────────────────────────────────────────

/** The line as it should be read on screen: romanised, or as written. */
function display(text: string): { line: string; original: string | null } {
  if (!prefs.romanize) return { line: text, original: null };
  if (scriptOf(text) === "latin") return { line: text, original: null };
  const romanised = romanizeMixed(text);
  const original = prefs.showOriginal && romanised !== text ? text : null;
  return { line: romanised, original };
}

function row(kind: "past" | "next" | "current", text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `row ${kind}`;
  const { line, original } = display(text);
  const span = document.createElement("span");
  span.className = "line";
  span.textContent = line;
  el.append(span);
  if (original) {
    const small = document.createElement("span");
    small.className = "original";
    small.textContent = original;
    el.append(small);
  }
  return el;
}

/** A row with nothing in it: keeps the card the same height at the song's ends. */
function blank(kind: "past" | "next"): HTMLElement {
  const el = document.createElement("div");
  el.className = `row ${kind}`;
  return el;
}

function note(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "note";
  el.textContent = text;
  return el;
}

/** The rows around the sung line, or a plain text's block. */
function rowsFor(index: number): HTMLElement[] {
  if (!song.timed.length) {
    // Plain words have no time: the first lines, as a block. A long block is
    // cut by the card's overflow rather than by counting lines nobody reads.
    return song.plain.map((line, i) => row(i === 0 ? "current" : "next", line));
  }
  const out: HTMLElement[] = [];
  for (let k = index - NEIGHBOURS; k < index; k++) {
    out.push(k >= 0 ? row("past", song.timed[k].text) : blank("past"));
  }
  out.push(row("current", song.timed[Math.max(0, index)].text));
  for (let k = index + 1; k <= index + NEIGHBOURS; k++) {
    out.push(k < song.timed.length ? row("next", song.timed[k].text) : blank("next"));
  }
  return out;
}

function draw() {
  const state = Spotify.state;
  const track = state.track;
  songEl.textContent = track && !isAd(track) ? [track.title, track.artist].filter(Boolean).join(" — ") : "";

  // No player, no song, an advertisement: a line saying so, never a blank card.
  if (!state.running || !track) {
    shownIndex = Number.NaN;
    rowsEl.replaceChildren(note(t("Nothing playing")));
    return;
  }
  if (isAd(track)) {
    shownIndex = Number.NaN;
    rowsEl.replaceChildren(note(t("Advertisement")));
    return;
  }
  if (loading) {
    shownIndex = Number.NaN;
    rowsEl.replaceChildren(note(t("Looking for the lyrics…")));
    return;
  }
  if (!song.timed.length && !song.plain.length) {
    shownIndex = Number.NaN;
    rowsEl.replaceChildren(note(t("No lyrics for this song")));
    return;
  }

  const index = song.timed.length ? Math.max(0, lineIndexAt(song.timed, spotifyPosition(state, Date.now()))) : 0;
  // The same line: nothing to redraw, which is most of the song.
  if (index === shownIndex && rowsEl.childElementCount) return;
  const entering = Number.isFinite(shownIndex) && index !== shownIndex;
  shownIndex = index;
  const rows = rowsFor(index);
  rowsEl.replaceChildren(...rows);
  // Only a timed song slides: plain words are a block that stays put.
  if (entering && song.timed.length) {
    rows.find((r) => r.classList.contains("current"))?.classList.add("enter");
  }
}

// ── The clock ────────────────────────────────────────────────────────────────

function startClock() {
  if (ticker != null) return;
  // While hidden there is nothing to move: the next show reads the player again.
  if (!up) return;
  ticker = window.setInterval(draw, TICK_MS);
}

function stopClock() {
  if (ticker == null) return;
  window.clearInterval(ticker);
  ticker = null;
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function apply(state: SpotifyState) {
  Spotify.state = state;
  playing = state.playing && state.track != null;
  // Hidden, the card is not on screen and nothing it would draw is seen: the
  // state is kept (the next show reads it), and the words are asked for then.
  if (!up) {
    stopClock();
    return;
  }
  void syncSong();
  if (playing) startClock();
  else stopClock();
  draw();
}

function setVisible(on: boolean) {
  up = on;
  if (!on) {
    stopClock();
    return;
  }
  // Coming back: the words of what plays now (no event said it while parked),
  // then the player, whose clock the refresh also re-reads.
  void syncSong();
  if (playing) startClock();
  void Bridge.spotifyRefresh().then((s) => {
    if (s) apply(s);
  });
  draw();
}

void onEvent<SpotifyState>("spotify", (s) => apply(s));
void onEvent<boolean>("lyrics-visible", (on) => setVisible(on));
// The preferences live in the app's settings: changing them repaints at once.
void onEvent<Settings>("settings-changed", (s) => {
  Object.assign(prefs, prefsFrom(s));
  shownIndex = Number.NaN;
  draw();
});

async function start() {
  const [on, saved] = await Promise.all([Bridge.lyricsVisible(), Bridge.lyricsPrefs()]);
  if (saved) Object.assign(prefs, prefsFrom({ lyricsRomanize: saved.romanize, lyricsShowOriginal: saved.showOriginal }));
  draw();
  setVisible(on === true);
}

void start();
