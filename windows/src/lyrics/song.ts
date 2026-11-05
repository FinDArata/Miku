// Is what plays a song, or just a video?
//
// Miku follows every player the system reports, not only Spotify: a browser
// watching YouTube looks exactly like one playing YouTube Music, and both look
// like a song when only the tags are read. The lyrics card is for songs, so it
// asks this first: a spoken-word video gets no card and no LRCLIB query.
//
// The rules are only hints, and they are meant to be quiet: Spotify and any id
// of its own are a song; the words a video's title carries ("reaction", "full
// movie", "podcast") are not; a length no song has — under 45 s, over 15 min —
// is not. Everything else is a song, because a wrong "yes" only shows a card
// with no words, while a wrong "no" hides the lyrics of a real song.

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
  "vlc", "mpv", "foobar2000", "potplayer",
];
/** Browsers report ordinary YouTube and YouTube Music with the same executable. */
const BROWSER_SOURCES = ["chrome", "msedge", "edge", "firefox", "brave", "opera", "vivaldi"];
/** Title evidence used only when a browser is the media source. */
const MUSIC_EVIDENCE = [
  "official audio", "official video", "official music video", "lyrics", "lyric video",
  "audio", "mv", "m/v", "topic", "single", "album", "track",
];

/**
 * Feed apps that publish a media session of their own. Scrolling one plays a
 * clip for a few seconds at a time, and what the session reports is the app's
 * own name — "Instagram", "TikTok" — with no artist, album or length. That is
 * not a track, and it must never pull up a lyrics card.
 */
const FEED_APPS = [
  "instagram", "tiktok", "facebook", "snapchat", "twitter", "x", "threads",
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
  /** Browser evidence says a video is probably a music upload. */
  | "music-evidence"
  /** A browser with no positive music evidence. */
  | "browser-video"
  /** A feed app's own session: Instagram scrolling, never a track. */
  | "feed-app"
  /** Nothing said otherwise, for an unknown source. */
  | "default";

function isBrowser(source: string): boolean {
  return BROWSER_SOURCES.some((word) => source.includes(word));
}

/**
 * The session's title is only the app's name, with nothing else attached: what
 * Instagram, TikTok and the other feeds publish while a clip plays. A real track
 * called "Threads" is spared, because it comes with an artist, an album or a
 * length, and this asks for all of them to be missing.
 */
function namesOnlyItsApp(track: Candidate): boolean {
  const title = (track.title ?? "").trim().toLowerCase();
  if (!title) return true;
  const bare = !(track.artist ?? "").trim()
    && !(track.album ?? "").trim()
    && !(Number.isFinite(track.duration) && track.duration > 0);
  if (!bare) return false;
  // "Instagram" itself, or "Instagram — Reels": the app name, perhaps followed
  // by the name of the screen the clip is on.
  const first = title.split(/\s*[-–—:|·/]\s*/)[0].trim();
  return FEED_APPS.includes(first) || FEED_APPS.includes(title);
}

function hasMusicEvidence(title: string, album: string | null | undefined, duration: number): boolean {
  if (MUSIC_EVIDENCE.some((word) => title.includes(word))) return true;
  if (album?.trim()) return true;
  return /\s-\s/.test(title) && Number.isFinite(duration) && duration <= 12 * 60;
}

/** The first rule that applies, in order. Pure: the same track, the same word. */
export function songVerdict(track: Candidate | null | undefined): SongVerdict {
  if (!track) return "video-title";
  const source = (track.source ?? "").toLowerCase();
  if (source && MUSIC_SOURCES.some((word) => source.includes(word))) return "music-source";
  if (SPOTIFY_ID.test(track.id)) return "spotify-id";
  // A feed app's own session, before any title word: "Instagram" is not a song
  // however it is spelled, and this is the one that used to slip through.
  if (namesOnlyItsApp(track)) return "feed-app";
  const title = (track.title ?? "").toLowerCase();
  if (VIDEO_WORDS.some((word) => title.includes(word))) return "video-title";
  const length = track.duration;
  if (Number.isFinite(length) && length > 0 && (length < MIN_SONG_SECONDS || length > MAX_SONG_SECONDS)) return "wrong-length";
  if (isBrowser(source)) return hasMusicEvidence(title, track.album, length) ? "music-evidence" : "browser-video";
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
