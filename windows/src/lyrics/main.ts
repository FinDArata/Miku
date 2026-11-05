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
import { ensureJapaneseTokenizer, japaneseReady, languageOfLines, pinyinReady, romanizeMixed, scriptOf, usePinyin } from "./romanize";
import { looksLikeSong } from "./song";
import { DEFAULT_PREFS, HIDE_AFTER_PAUSE_MS, autoAction, prefsFrom } from "./state";
import { buildContextMenu, type LookValues } from "./menu";

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
  songLanguage = null;
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

  // A video is not a song: no words to fetch, and no question for LRCLIB. The
  // words already on the card stay, though: the user detached this card and a
  // video starting in another tab is not a reason to blank it. `songFor` is
  // left alone, so the same song coming back redraws without a second query.
  if (!looksLikeSong(track, currentLyricsVideos())) return;

  const known = cachedSong(track);
  if (known || knownMissing(track)) {
    generation++;
    loading = false;
    song = known ?? EMPTY;
    songFor = key;
    shownIndex = Number.NaN;
    draw();
    if (song.timed.length || song.plain.length) void ensureRomanisation();
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
  if (song.timed.length || song.plain.length) void ensureRomanisation();
}

// ── Romaji, pinyin, when a line needs them ───────────────────────────────────

let japaneseAsked = false;
let pinyinAsked = false;

/** Reads every line of the song once: its language, and the library it needs. */
async function ensureRomanisation() {
  const lines = [...song.timed.map((l) => l.text), ...song.plain];
  songLanguage = languageOfLines(lines);
  if (songLanguage === "japanese") {
    if (japaneseReady() || japaneseAsked) return;
    japaneseAsked = true;
    if (await ensureJapaneseTokenizer()) {
      shownIndex = Number.NaN;
      draw();
    }
    return;
  }
  if (songLanguage !== "chinese" || pinyinReady() || pinyinAsked) return;
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
let songLanguage: "japanese" | "chinese" | null = null;

function display(text: string): { line: string; original: string | null } {
  if (!prefs.romanize) return { line: text, original: null };
  if (scriptOf(text) === "latin") return { line: text, original: null };
  const romanised = romanizeMixed(text, songLanguage);
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
  // A video (a talk, a reaction, a film) has no lyrics of its own. It never
  // opens a card, but a card already up keeps the words and the title it had
  // rather than being blanked by whatever else started in another tab — the
  // clock is stopped for it, so the line it reached stays where it was.
  if (track != null && !isAd(track) && !looksLikeSong(track, currentLyricsVideos())
    && (song.timed.length || song.plain.length)) {
    return;
  }
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
  if (!looksLikeSong(track, currentLyricsVideos())) {
    shownIndex = Number.NaN;
    rowsEl.replaceChildren(note(t("This is not a song")));
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
  autoShowOrHide();
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

// ── Opening and closing by itself ────────────────────────────────────────────
//
// A song starting brings the card up; a pause that lasts past its grace, or a
// stop, takes it away. The switch in Settings still decides whether any of this
// happens at all (state.ts holds the rule, tested on its own).

/** The auto behaviour is on only when the user turned the overlay on. */
let autoEnabled = false;
let hideTimer: number | null = null;
let lyricsVideos = false;

function currentLyricsVideos(): boolean {
  return lyricsVideos;
}

/** Where the app draws lyrics now; the floating page stays out of the way in the island. */
function lyricsPlacement(): "island" | "floating" {
  return prefs.placement ?? "island";
}

function clearHideTimer() {
  if (hideTimer != null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

/** Shows the card for a song that just started; hides it when nothing plays. */
function autoShowOrHide() {
  const track = Spotify.state.track;
  // The island draws a playing song: the floating card stays out of the way.
  if (lyricsPlacement() === "island") {
    if (up) hideForNow();
    return;
  }
  const action = autoAction({
    enabled: autoEnabled,
    up,
    waiting: hideTimer != null,
    playing,
    // A detached card is explicit: ordinary videos must not make it disappear.
    hasTrack: track != null && !isAd(track),
    hasSong: track != null && !isAd(track) && looksLikeSong(track, currentLyricsVideos()),
  });
  // Playback resumed inside the grace period: the hide that was counted down
  // for the pause must not fire on a song that is playing again.
  if (hideTimer != null && playing && track != null) clearHideTimer();
  switch (action) {
    case "show":
      up = true;
      clearHideTimer();
      void Bridge.lyricsAutoShow();
      void syncSong();
      startClock();
      draw();
      break;
    case "hide":
      clearHideTimer();
      hideForNow();
      break;
    case "wait":
      hideTimer = window.setTimeout(() => {
        hideTimer = null;
        hideForNow();
      }, HIDE_AFTER_PAUSE_MS);
      break;
    case "stay":
      break;
  }
}

/** Takes the card off screen without turning the switch in Settings off. */
function hideForNow() {
  up = false;
  stopClock();
  void Bridge.lyricsAutoHide();
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
// Rust parked or brought back the window by itself (a song started, the music
// stopped): the page follows without touching the switch in Settings.
void onEvent<boolean>("lyrics-shown", (on) => setVisible(on));
void onEvent<boolean>("lyrics-visible", (on) => {
  // The switch in Settings is the master, both ways: turned off, nothing
  // reopens the card by itself; turned on, it follows the music again.
  autoEnabled = on;
  if (!on) clearHideTimer();
  setVisible(on);
});
// The preferences live in the app's settings: changing them repaints at once.
void onEvent<Settings>("settings-changed", (s) => {
  lyricsVideos = s.lyricsVideos === true;
  Object.assign(prefs, prefsFrom(s));
  prefs.placement = s.lyrics?.placement ?? (s as { lyricsPlacement?: "island" | "floating" }).lyricsPlacement ?? "island";
  applyLook(s);
  shownIndex = Number.NaN;
  draw();
});

// ── The card's own menu (a right-click) ─────────────────────────────────────
//
// The six values below are the ones the card owns; everything else is a step
// away, in Settings. `lastLook` is what the page was last told, so the menu
// opens on the values actually in force rather than on a guess.

let lastLook: Partial<LookValues> = {};

const menu = buildContextMenu({
  look: () => ({
    opacity: lastLook.opacity ?? 0.25,
    fontSize: lastLook.fontSize ?? 16,
    textColor: lastLook.textColor ?? "#ffffff",
    background: lastLook.background ?? "#08090c",
    width: lastLook.width ?? 420,
    height: lastLook.height ?? 170,
  }),
  apply: (patch) => {
    lastLook = { ...lastLook, ...patch };
    applyLook(lastLook);
    // Rust writes only these fields, and every window hears the result.
    void Bridge.lyricsSetLook(patch);
  },
  openSettings: () => void Bridge.openSettingsWindow(),
  placement: () => lyricsPlacement(),
  setPlacement: (placement) => {
    prefs.placement = placement;
    void Bridge.lyricsSetPlacement(placement);
    if (placement === "island") autoShowOrHide();
  },
  // The menu is taller than the card, so the window grows for it and shrinks
  // back afterwards. Neither is saved: the card's own size is the setting.
  grow: (width, height) => void Bridge.lyricsWindowSize(width, height),
  shrink: () => void Bridge.lyricsWindowSize(lastLook.width ?? 420, lastLook.height ?? 170),
});

document.addEventListener("contextmenu", (e) => {
  // The card is the whole window: anywhere on it is the right place.
  e.preventDefault();
  menu.open(e.clientX, e.clientY);
});

/**
 * Dresses the card from a set of look settings. Both shapes reach this: the
 * window's own `LyricsPrefs` at launch (camelCase, `textColor`) and the app's
 * `Settings` after a change (flat, `lyricsTextColor`). Every value is already
 * checked by Rust, and each only lands in a custom property, never in markup.
 */
function applyLook(look: {
  opacity?: number;
  fontSize?: number;
  textColor?: string;
  background?: string;
  lyricsOpacity?: number;
  lyricsFontSize?: number;
  lyricsTextColor?: string;
  lyricsBackground?: string;
} | null | undefined) {
  if (!look) return;
  const root = document.documentElement;
  const opacity = look.opacity ?? look.lyricsOpacity;
  const size = look.fontSize ?? look.lyricsFontSize;
  const ink = look.textColor ?? look.lyricsTextColor;
  const bg = look.background ?? look.lyricsBackground;
  if (typeof opacity === "number" && Number.isFinite(opacity)) {
    root.style.setProperty("--lyrics-opacity", String(Math.min(1, Math.max(0, opacity))));
  }
  if (typeof size === "number" && Number.isFinite(size)) {
    root.style.setProperty("--lyrics-size", `${Math.min(40, Math.max(10, size))}px`);
  }
  if (isHex(ink)) root.style.setProperty("--lyrics-ink", ink);
  if (isHex(bg)) root.style.setProperty("--lyrics-bg", bg);
  // The menu opens on what is in force, so keep the last values applied.
  lastLook = {
    ...lastLook,
    ...(typeof opacity === "number" && Number.isFinite(opacity) ? { opacity } : {}),
    ...(typeof size === "number" && Number.isFinite(size) ? { fontSize: size } : {}),
    ...(isHex(ink) ? { textColor: ink } : {}),
    ...(isHex(bg) ? { background: bg } : {}),
  };
}

/** `#RRGGBB` only: anything else is ignored rather than pasted into a style. */
function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

async function start() {
  const [on, saved] = await Promise.all([Bridge.lyricsVisible(), Bridge.lyricsPrefs(), Bridge.spotifyRefresh()]);
  if (saved) {
    Object.assign(prefs, prefsFrom({ lyricsRomanize: saved.romanize, lyricsShowOriginal: saved.showOriginal }));
    prefs.placement = saved.placement ?? "island";
  }
  lyricsVideos = saved?.videos === true;
  applyLook(saved ?? null);
  // The switch in Settings is the master: on, the card opens and closes with the
  // music by itself; off, it never appears on its own.
  autoEnabled = on === true;
  draw();
  setVisible(on === true);
  // Read the player once so a song already playing opens the card.
  if (autoEnabled) void Bridge.spotifyRefresh().then((s) => s && apply(s));
}

void start();
