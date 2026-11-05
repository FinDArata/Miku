// Is what plays a song, or just a video?
//
// Miku follows every player the system reports, not only Spotify: a browser
// watching YouTube looks exactly like one playing YouTube Music, and both look
// like a song when only the tags are read. The lyrics card is for songs, so it
// asks this first: a video gets no card and no LRCLIB query.
//
// The rules are only hints, and they are meant to be quiet: Spotify and any id
// of its own are a song; the words a video's title carries ("reaction", "full
// movie", "podcast") are not; a length no song has — under 45 s, over 15 min —
// is not. A program we cannot place is treated as a browser, because on Windows
// the media session only carries an app user model id, which for a desktop
// browser is an opaque hash ("308046B0AF4A39CB" is Firefox) with nothing to read
// in it. A wrong "yes" puts a card over a video someone is watching; a wrong "no"
// only asks a music upload to name itself.

import type { SpotifyTrack } from "../core/spotify";

/** Under this many seconds, nothing is a song (a jingle, a Short, a preview). */
export const MIN_SONG_SECONDS = 45;
/** Over this many seconds, it is a talk, a set, a film (15 min). */
export const MAX_SONG_SECONDS = 15 * 60;

/** Title words that say the thing is watched, not listened to. */
const VIDEO_WORDS = [
  "#shorts",
  "reaction",
  "episode",
  "full movie",
  "podcast",
  "mukbang",
  "highlights",
  "tutorial",
  "compilation",
  "trailer",
];

/** Sources that identify a music player rather than a general browser. */
const MUSIC_SOURCES = [
  "spotify", "music", "music.youtube.com", "apple music", "applemusic", "rhythmbox",
  "vlc", "mpv", "foobar2000", "potplayer", "zunemusic", "groove", "deezer", "tidal",
  "soundcloud", "itunes", "aimp", "winamp",
];
/**
 * Browsers, by executable or name. Windows hands over an app user model id that
 * spotify.rs resolves to the owning executable ("firefox.exe", "chrome.exe"), so
 * these words are what a recognised browser matches on.
 */
const BROWSER_SOURCES = ["chrome", "msedge", "edge", "firefox", "brave", "opera", "vivaldi", "safari"];

/**
 * Evidence that a browser is playing a song rather than a video. Read from live
 * media sessions on this machine, which is the only reliable guide:
 *
 *   YouTube Music: "Heart of Lahai-Roi", artist "Wuthering Waves, baitian, …",
 *                  album EMPTY, duration 205.98 s
 *   YouTube video: "That's an Insane Amount of Chili!", artist "Quick Fact
 *                  Room", album EMPTY, duration 0
 *
 * So an album proves nothing — both report none — and a length does: a player
 * knows how long a track runs, while a live page or a feed reports none. A title
 * that names itself as music ("official audio", "[Lyrics]") counts too.
 */
const MUSIC_EVIDENCE = [
  "official audio", "official video", "official music video", "lyrics", "lyric video",
  "audio", "mv", "m/v", "topic", "single",
];

/**
 * Feed apps that publish a media session of their own. Scrolling one plays a
 * clip for a few seconds at a time, and what the session reports is the app's
 * own name — "Instagram", "TikTok" — with no length. That is not a track, and it
 * must never pull up a lyrics card.
 */
const FEED_APPS = [
  "instagram", "tiktok", "facebook", "snapchat", "twitter", "threads",
  "reddit", "discord", "telegram", "whatsapp", "netflix", "twitch",
];

/** "spotify:track:" and a 22-character base62 id: a URI the player made itself. */
const SPOTIFY_ID = /^spotify:(?:track|episode|local):[0-9A-Za-z]{22}$/;

/** The track fields this needs: the overlay's tracks always carry them. */
type Candidate = Pick<SpotifyTrack, "id" | "title" | "album" | "duration"> & {
  source?: string | null;
  artist?: string | null;
};

/**
 * Why a track was taken as a song or not. Returned instead of a bare boolean so
 * the table in tests reads as the rules it checks, and a bug names its branch.
 */
export type SongVerdict =
  /** The program only plays music: Spotify itself, or YouTube Music. */
  | "music-source"
  /** A Spotify id: a track or an episode, which the player already calls a song. */
  | "spotify-id"
  /** A word in the title says a video ("reaction", "podcast"). */
  | "video-title"
  /** Too short or too long to be a song. */
  | "wrong-length"
  /** Browser evidence says this is a music upload. */
  | "music-evidence"
  /** A browser, or a program we cannot place, with no evidence of music. */
  | "browser-video"
  /** A feed app's own session: Instagram scrolling, never a track. */
  | "feed-app"
  /** Nothing said otherwise: no source at all. */
  | "default";

function isBrowser(source: string): boolean {
  return BROWSER_SOURCES.some((word) => source.includes(word));
}

/**
 * A program we cannot place: not one of the music players, not a browser we
 * know by name. On Windows that is most desktop programs, since the source is an
 * app user model id. Treated like a browser, so it needs evidence to show words.
 */
function isUnknownProgram(source: string): boolean {
  if (!source) return false;
  return !MUSIC_SOURCES.some((word) => source.includes(word)) && !isBrowser(source);
}

/**
 * Whether this session belongs to a feed app: Instagram, TikTok and the rest.
 * Scrolling one plays clips a few seconds long, and what the session reports is
 * the app's own name, its own "artist" and its own collection as the album. None
 * of that makes it a track, so the source alone decides — a song called
 * "Instagram" playing in Spotify is still a song, because that is not this.
 */
function isFeedSession(track: Candidate): boolean {
  const source = (track.source ?? "").toLowerCase();
  return FEED_APPS.some((app) => source.includes(app));
}

/**
 * Whether a browser is playing music rather than a video: a plausible track
 * length (measured above: YouTube Music 205.98 s, a YouTube video 0), or a title
 * that says so. A page reporting no length is a video as far as this is
 * concerned, which is the safe way round — it holds the words of a song already
 * playing instead of replacing them.
 */
function hasMusicEvidence(title: string, duration: number): boolean {
  if (MUSIC_EVIDENCE.some((word) => title.includes(word))) return true;
  return Number.isFinite(duration) && duration >= MIN_SONG_SECONDS && duration <= MAX_SONG_SECONDS;
}

/** The first rule that applies, in order. Pure: the same track, the same word. */
export function songVerdict(track: Candidate | null | undefined): SongVerdict {
  if (!track) return "video-title";
  const source = (track.source ?? "").toLowerCase();
  if (source && MUSIC_SOURCES.some((word) => source.includes(word))) return "music-source";
  if (SPOTIFY_ID.test(track.id)) return "spotify-id";
  // A feed app's own session, before any title word: scrolling Instagram is not
  // a song however it is spelled, and this is the one that used to slip through.
  if (isFeedSession(track)) return "feed-app";
  const title = (track.title ?? "").toLowerCase();
  if (VIDEO_WORDS.some((word) => title.includes(word))) return "video-title";
  const length = track.duration;
  if (Number.isFinite(length) && length > 0 && (length < MIN_SONG_SECONDS || length > MAX_SONG_SECONDS)) {
    return "wrong-length";
  }
  // A browser — recognised, or one we cannot place — needs evidence of music.
  // This is what stops a YouTube video reading as a song: with the app user
  // model id resolved to "firefox.exe", it lands here and is read as a video.
  if (isBrowser(source) || isUnknownProgram(source)) {
    return hasMusicEvidence(title, length) ? "music-evidence" : "browser-video";
  }
  return "default";
}

/** Whether the lyrics card belongs to this track: only a song gets words. */
export function looksLikeSong(track: Candidate | null | undefined, lyricsVideos = false): boolean {
  const verdict = songVerdict(track);
  // A feed app's session is never a song, whatever "Show lyrics for videos too"
  // says: scrolling Instagram is not watching a concert.
  if (verdict === "feed-app") return false;
  if (lyricsVideos && verdict === "browser-video") return true;
  return verdict === "music-source" || verdict === "spotify-id" || verdict === "music-evidence" || verdict === "default";
}
