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
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bridge, IS_TAURI, onEvent, type LyricsPrefs } from "../core/bridge";
import { Spotify, currentArtwork, isAd, spotifyPosition, type SpotifyState } from "../core/spotify";
import { CHIBI_H, CHIBI_W, drawChibi } from "../mochi/chibi";
import { parseVariant, resolveVariantNow } from "../mochi/wardrobe";
import { ctx2d } from "../core/canvas";
import type { Settings } from "../core/state";
import { t } from "../i18n/i18n";
import { cachedSong, fetchSong, knownMissing } from "./fetch";
import { instrumentalAt, lineIndexAt, nextSungLine, previousSungLine, sungFraction, type Song } from "./lrc";
import { ensureJapaneseTokenizer, japaneseReady, languageOfLines, pinyinReady, romanizeMixed, scriptOf, usePinyin } from "./romanize";
import { looksLikeSong } from "./song";
import { DEFAULT_PREFS, HIDE_AFTER_PAUSE_MS, autoAction, prefsFrom } from "./state";
import { buildContextMenu, type LookValues } from "./menu";

/** How often the line is re-read inside a song, in ms: a line lasts seconds. */
const TICK_MS = 200;

const rowsEl = document.getElementById("rows")!;
const songEl = document.getElementById("song")!;
const titleEl = document.getElementById("song-title")!;
const artistEl = document.getElementById("song-artist")!;
const artEl = document.getElementById("song-art")!;
const artImg = artEl.querySelector("img")!;
const mikuCanvas = document.getElementById("song-miku") as HTMLCanvasElement;

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
/** Whether it was drawn in an interlude: a note instead of words. */
let shownInterlude = false;
let ticker: number | null = null;
/** Whether this window is up at all. */
let up = false;

// ── The words ─────────────────────────────────────────────────────────────────

/** What two reports of a track are the same by. */
export function trackKey(track: { artist: string; title: string; duration: number }): string {
  return [track.artist, track.title, String(Math.round(track.duration))].join("\u0000");
}

/** LRCLIB answered with words for this very track (what makes a browser track with only a length a song). */
function wordsFor(track: { artist: string; title: string; duration: number }): boolean {
  return songFor === trackKey(track) && !loading && (song.timed.length > 0 || song.plain.length > 0);
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
  if (!looksLikeSong(track, currentLyricsVideos(), true)) return;

  const known = cachedSong(track);
  if (known || knownMissing(track)) {
    generation++;
    loading = false;
    song = known ?? EMPTY;
    songFor = key;
    shownIndex = Number.NaN;
    draw();
    if (song.timed.length || song.plain.length) void ensureRomanisation();
    // Words for a browser track that only had a song's length: now it is one.
    autoShowOrHide();
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
  autoShowOrHide();
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

// Romaji on, the line is read in letters only: the words as written are not
// repeated under it (the notices keep their own romaji line, see history.ts).
function display(text: string): string {
  if (!prefs.romanize || scriptOf(text) === "latin") return text;
  return romanizeMixed(text, songLanguage, romajiLangs);
}

function row(kind: "past" | "next" | "current", text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `row ${kind}`;
  const span = document.createElement("span");
  span.className = "line";
  // The words sit in an inline span: its wipe runs along a wrapped line's rows
  // one after the other, where the block's would colour both rows at once.
  const ink = document.createElement("span");
  ink.className = "ink";
  ink.textContent = display(text);
  span.append(ink);
  el.append(span);
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
function rowsFor(index: number, interlude: boolean): HTMLElement[] {
  if (!song.timed.length) {
    // Plain words have no time: the first lines, as a block. A long block is
    // cut by the card's overflow rather than by counting lines nobody reads.
    return song.plain.map((line, i) => row(i === 0 ? "current" : "next", line));
  }
  const out: HTMLElement[] = [];
  // The lines around the sung one skip the instrumental gaps LRCLIB stamps, so
  // a verse's first line is not shown with an empty line above it.
  const before = previousSungLine(song.timed, index);
  const after = nextSungLine(song.timed, index);
  out.push(before >= 0 ? row("past", song.timed[before].text) : blank("past"));
  // An interlude is music alone: a note in place of words no one is singing.
  out.push(row("current", interlude ? "♪ …" : song.timed[Math.max(0, index)].text));
  out.push(after >= 0 ? row("next", song.timed[after].text) : blank("next"));
  return out;
}

function draw() {
  const state = Spotify.state;
  const track = state.track;
  // A video (a talk, a reaction, a film) has no lyrics of its own. It never
  // opens a card, but a card already up keeps the words and the title it had
  // rather than being blanked by whatever else started in another tab — the
  // clock is stopped for it, so the line it reached stays where it was.
  if (track != null && !isAd(track) && !looksLikeSong(track, currentLyricsVideos(), wordsFor(track))
    && (song.timed.length || song.plain.length)) {
    return;
  }
  drawHeader(track && !isAd(track) ? track : null);
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
  if (!looksLikeSong(track, currentLyricsVideos(), wordsFor(track))) {
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

  const at = spotifyPosition(state, Date.now());
  const index = song.timed.length ? Math.max(0, lineIndexAt(song.timed, at)) : 0;
  // Music alone — a long intro, an interlude — is not words to sing.
  const interlude = song.timed.length ? instrumentalAt(song.timed, index, at, track.duration) : false;
  // The same line: only the wipe moves, which is most of the song.
  if (index === shownIndex && interlude === shownInterlude && rowsEl.childElementCount) {
    sing(index, at, track.duration, interlude);
    return;
  }
  const entering = Number.isFinite(shownIndex) && index !== shownIndex;
  shownIndex = index;
  shownInterlude = interlude;
  const rows = rowsFor(index, interlude);
  rowsEl.replaceChildren(...rows);
  // Only a timed song slides: plain words are a block that stays put.
  if (entering && song.timed.length) {
    rows.find((r) => r.classList.contains("current"))?.classList.add("enter");
  }
  sing(index, at, track.duration, interlude);
  fitWindow();
}

/** The karaoke wipe on the sung line; plain words have no time to wipe by. */
let inkEl: HTMLElement | null = null;
function sing(index: number, at: number, duration: number, interlude = false) {
  if (!song.timed.length) return;
  // The current line's ink, remembered: a selector match per tick walked the
  // rows five times a second. The rows are replaced on a line change, so the
  // remembered element is disconnected then and found anew.
  if (!inkEl?.isConnected) inkEl = rowsEl.querySelector<HTMLElement>(".row.current .ink");
  const line = inkEl;
  if (!line) return;
  line.classList.add("sing");
  // An interlude's note does not sing: no wipe across it.
  line.style.setProperty("--sung", interlude ? "0%" : `${(sungFraction(song.timed, index, at, duration) * 100).toFixed(1)}%`);
}

/** Title, artist and cover at the top of the card; empty for an ad or no song. */
let headerKey: string | null = null;
function drawHeader(track: { title: string; artist: string } | null) {
  // Written every 200 ms tick, but only the track change makes it differ.
  const key = `${track?.title ?? ""}|${track?.artist ?? ""}|${track ? currentArtwork(Spotify.state) : ""}`;
  if (key === headerKey) return;
  headerKey = key;
  titleEl.textContent = track?.title ?? "";
  artistEl.textContent = track?.artist ?? "";
  songEl.classList.toggle("empty", !track);
  const cover = track ? currentArtwork(Spotify.state) : null;
  artEl.classList.toggle("has-art", !!cover);
  if (cover) {
    if (artImg.getAttribute("src") !== cover) artImg.setAttribute("src", cover);
  } else {
    artImg.removeAttribute("src");
  }
}

// ── Miku in the corner ───────────────────────────────────────────────────────
//
// She sings while the song plays and stands still otherwise, at the screen's
// own frame rate; nothing runs while the card is hidden or she is turned off.

let mikuVariant = parseVariant("auto");
let mikuTimer: number | null = null;
const mikuStart = performance.now();

function paintMiku() {
  const x = ctx2d(mikuCanvas);
  if (!x) return;
  const dpr = window.devicePixelRatio || 1;
  const w = mikuCanvas.clientWidth;
  const hgt = mikuCanvas.clientHeight;
  if (!w || !hgt) return;
  if (mikuCanvas.width !== Math.round(w * dpr)) mikuCanvas.width = Math.round(w * dpr);
  if (mikuCanvas.height !== Math.round(hgt * dpr)) mikuCanvas.height = Math.round(hgt * dpr);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, mikuCanvas.width, mikuCanvas.height);
  const scale = Math.min(mikuCanvas.width / CHIBI_W, mikuCanvas.height / CHIBI_H);
  x.setTransform(scale, 0, 0, scale, (mikuCanvas.width - CHIBI_W * scale) / 2, mikuCanvas.height - CHIBI_H * scale);
  const pose = playing ? "singing" : "idle";
  drawChibi(x, pose, playing ? (performance.now() - mikuStart) / 1000 : 0, resolveVariantNow(mikuVariant), { noShadow: true });
}

function mikuLoop() {
  mikuTimer = null;
  if (!(up && playing && showMiku)) return;
  paintMiku();
  mikuTimer = requestAnimationFrame(mikuLoop);
}

function syncMiku() {
  const run = up && playing && showMiku;
  if (run && mikuTimer == null) mikuTimer = requestAnimationFrame(mikuLoop);
  else if (!run && mikuTimer != null) {
    cancelAnimationFrame(mikuTimer);
    mikuTimer = null;
  }
  paintMiku();
}

// ── The window wraps the card ────────────────────────────────────────────────
//
// The card fills its window, and the window is as tall as what the card holds:
// no frame of empty (blurred) window around it. Not saved: it follows the words.

let fittedHeight = 0;

function fitWindow() {
  if (!up || menu.isOpen()) return;
  const card = document.getElementById("lyrics");
  if (!card) return;
  const style = getComputedStyle(card);
  const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const words = rowsEl.scrollHeight + pad;
  const miku = showMiku ? mikuCanvas.offsetHeight + 8 : 0;
  const want = Math.ceil(Math.max(90, words, miku));
  if (Math.abs(want - fittedHeight) < 2) return;
  fittedHeight = want;
  void Bridge.lyricsWindowSize(lastLook.width ?? 420, want);
}

// ── The clock ────────────────────────────────────────────────────────────────

function startClock() {
  if (ticker != null) return;
  // Hidden, the card still keeps its line while lyrics are on (the user may
  // detach it any moment): shown, it is already on the line being sung. Only a
  // changed line touches the page, so this costs next to nothing.
  if (!up && !autoEnabled) return;
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
  // Hidden, nothing is drawn — but the song's words are fetched already, so a
  // card detached mid-song starts on the right line at once instead of
  // waiting for LRCLIB (and the dictionary) only then.
  if (!up) {
    if (autoEnabled) {
      void syncSong();
      if (playing) startClock();
      else stopClock();
    } else {
      stopClock();
    }
    return;
  }
  void syncSong();
  if (playing) startClock();
  else stopClock();
  draw();
  syncMiku();
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
let netease = false;

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
    hasSong: track != null && !isAd(track) && looksLikeSong(track, currentLyricsVideos(), wordsFor(track)),
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
  syncMiku();
  if (!on) {
    // Lyrics still on: the line keeps up while hidden (see startClock).
    if (!autoEnabled || !playing) stopClock();
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
// The cover arrives on its own, after the track: the header picks it up.
void onEvent<{ artUrl: string; dataUrl: string }>("spotify-artwork", (art) => {
  Spotify.artwork = art;
  drawHeader(Spotify.state.track && !isAd(Spotify.state.track) ? Spotify.state.track : null);
});
// Rust says the window really has Acrylic behind it: the card goes translucent,
// so the blur shows instead of hiding under it.
void onEvent<null>("material", () => document.body.classList.add("acrylic"));
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
  // Another source: the song playing is asked again.
  if ((s.lyricsNetease === true) !== netease) {
    netease = s.lyricsNetease === true;
    songFor = "";
    void syncSong();
  }
  mikuVariant = parseVariant(s.mikuVariant);
  if (Array.isArray(s.lyricsRomajiLangs)) romajiLangs = s.lyricsRomajiLangs;
  Object.assign(prefs, prefsFrom(s));
  prefs.placement = s.lyrics?.placement ?? (s as { lyricsPlacement?: "island" | "floating" }).lyricsPlacement ?? "island";
  applyLook(s);
  applyBehaviour({ locked: s.lyricsLocked === true, clickThrough: s.lyricsClickThrough === true });
  applyDressing({ showMiku: s.lyricsShowMiku !== false, showCover: s.lyricsShowCover !== false, transparent: s.lyricsTransparent === true });
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
  locked: () => locked,
  setLocked: (on) => {
    applyBehaviour({ locked: on });
    void Bridge.lyricsSetLook({ locked: on });
  },
  toggles: () => [
    { label: t("Transparent card"), on: transparent, set: (on: boolean) => {
      applyDressing({ transparent: on });
      void Bridge.lyricsSetLook({ transparent: on });
    } },
    { label: t("Romaji"), on: prefs.romanize, set: (on: boolean) => void Bridge.lyricsSetLook({ romanize: on }) },
    { label: t("Show Miku on the card"), on: showMiku, set: (on: boolean) => {
      applyDressing({ showMiku: on });
      void Bridge.lyricsSetLook({ showMiku: on });
    } },
    { label: t("Show the album cover"), on: showCover, set: (on: boolean) => {
      applyDressing({ showCover: on });
      void Bridge.lyricsSetLook({ showCover: on });
    } },
  ],
  setClickThrough: () => {
    applyBehaviour({ clickThrough: true });
    void Bridge.lyricsSetLook({ clickThrough: true });
  },
  placement: () => lyricsPlacement(),
  setPlacement: (placement) => {
    prefs.placement = placement;
    void Bridge.lyricsSetPlacement(placement);
    if (placement === "island") autoShowOrHide();
  },
  // The menu is taller than the card, so the window grows for it and shrinks
  // back afterwards. Neither is saved: the card's own size is the setting.
  grow: (width, height) => void Bridge.lyricsWindowSize(width, height),
  shrink: () => void Bridge.lyricsWindowSize(lastLook.width ?? 420, fittedHeight || (lastLook.height ?? 170)),
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

// ── Locked and click-through ─────────────────────────────────────────────────

let locked = false;
let clickThrough = false;
let showMiku = true;
/** Which languages the user wants romanised (Settings → Lyrics). */
let romajiLangs: readonly string[] = ["ja", "ko"];
let showCover = true;
let transparent = false;

/** Miku in the corner and the cover in the header, each the user's to hide. */
function applyDressing(next: { showMiku?: boolean; showCover?: boolean; transparent?: boolean }) {
  if (typeof next.showMiku === "boolean") showMiku = next.showMiku;
  if (typeof next.showCover === "boolean") showCover = next.showCover;
  if (typeof next.transparent === "boolean") transparent = next.transparent;
  document.body.classList.toggle("see-through", transparent);
  document.body.classList.toggle("no-miku", !showMiku);
  document.body.classList.toggle("no-cover", !showCover);
  syncMiku();
}

/** Locked: a press no longer drags. Click-through: the window ignores the
 *  pointer, so the way back is Settings → General (the card cannot be clicked). */
function applyBehaviour(next: { locked?: boolean; clickThrough?: boolean }) {
  if (typeof next.locked === "boolean") locked = next.locked;
  const through = typeof next.clickThrough === "boolean" ? next.clickThrough : clickThrough;
  const card = document.getElementById("lyrics");
  if (locked) card?.removeAttribute("data-tauri-drag-region");
  else card?.setAttribute("data-tauri-drag-region", "deep");
  document.body.classList.toggle("locked", locked);
  if (through !== clickThrough || typeof next.clickThrough === "boolean") {
    clickThrough = through;
    document.body.classList.toggle("click-through", clickThrough);
    if (IS_TAURI) void getCurrentWindow().setIgnoreCursorEvents(clickThrough).catch(() => undefined);
  }
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
  applyBehaviour({ locked: saved?.locked === true, clickThrough: saved?.clickThrough === true });
  if (Array.isArray(saved?.romajiLangs)) romajiLangs = saved.romajiLangs;
  applyDressing({ showMiku: saved?.showMiku !== false, showCover: saved?.showCover !== false, transparent: saved?.transparent === true });
  // The switch in Settings is the master: on, the card opens and closes with the
  // music by itself; off, it never appears on its own.
  autoEnabled = on === true;
  draw();
  setVisible(on === true);
  // Read the player once so a song already playing opens the card.
  if (autoEnabled) void Bridge.spotifyRefresh().then((s) => s && apply(s));
  // The Japanese dictionary takes seconds to build and holds the page while it
  // does: built now, in the background, the card never stalls on it later.
  if (prefs.romanize && romajiLangs.includes("ja")) {
    window.setTimeout(() => void ensureJapaneseTokenizer(), 2000);
  }
}

void start();
