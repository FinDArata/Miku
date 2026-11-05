// Which tracks the lyrics card belongs to. A browser playing YouTube looks the
// same as one playing YouTube Music when only the tags are read, so the rules
// here are what keep a film or a podcast from pulling up a lyrics card — and
// what keep a real song from being turned away.

import { test } from "node:test";
import assert from "node:assert/strict";

const { looksLikeSong, songVerdict, MIN_SONG_SECONDS, MAX_SONG_SECONDS } = await import("../src/lyrics/song.ts");

/** A track as the player reports it, with only what a case cares about set.
 *  The id is Windows' own hash, not a Spotify URI, so the title and length
 *  rules are what decide unless a case says otherwise. */
const track = (o = {}) => ({
  id: "windows:track:3f2c1a9e7b4d6c8a",
  title: "Song",
  artist: "Artist",
  duration: 210,
  source: null,
  ...o,
});

// ── The program that publishes it ─────────────────────────────────────────────

test("Spotify is a song, whatever the program id looks like", () => {
  assert.equal(songVerdict(track({ source: "Spotify.exe" })), "music-source");
  assert.equal(songVerdict(track({ source: "spotify" })), "music-source");
  // The Microsoft Store package id.
  assert.equal(songVerdict(track({ source: "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" })), "music-source");
});

test("a player whose name says music is a song by the source alone", () => {
  // YouTube Music as a PWA reports its own origin; so do other music players.
  for (const source of ["music.youtube.com", "Music", "com.spotify.Client"]) {
    assert.equal(songVerdict(track({ source })), "music-source", source);
    assert.equal(looksLikeSong(track({ source })), true, source);
  }
});

test("ordinary browsers need music evidence, while local players remain trusted", () => {
  // A page reporting no length is a video: measured live, a YouTube video
  // reports 0 while YouTube Music reports the track's own length.
  for (const source of ["chrome.exe", "MSEdge", "firefox", "brave", "opera", "vivaldi"]) {
    assert.equal(songVerdict(track({ source, title: "Some song", album: "", duration: 0 })), "browser-video", source);
    assert.equal(looksLikeSong(track({ source, title: "Some song", album: "", duration: 0 })), false, source);
    assert.equal(songVerdict(track({ source, title: "How to fix a bike — tutorial" })), "video-title", source);
  }
  for (const source of ["vlc", "mpv", "foobar2000", "potplayer"]) {
    assert.equal(songVerdict(track({ source, title: "Some song" })), "music-source", source);
    assert.equal(looksLikeSong(track({ source, title: "Some song" })), true, source);
  }
});

test("a browser that reports a track's length is playing one", () => {
  // The measurement this rule is built on: YouTube Music reported 205.98 s for
  // a song and no length at all for a video.
  for (const source of ["chrome.exe", "firefox", "Mozilla Firefox"]) {
    const song = track({ source, title: "Heart of Lahai-Roi", album: "", duration: 205.98 });
    assert.equal(songVerdict(song), "music-evidence", source);
    assert.equal(looksLikeSong(song), true, source);
    // A length no song has still rules it out.
    assert.equal(songVerdict(track({ source, title: "Song", duration: 20 })), "wrong-length", source);
    assert.equal(songVerdict(track({ source, title: "Song", duration: 3600 })), "wrong-length", source);
  }
});

test("browser music evidence accepts official uploads and artist-title tracks", () => {
  for (const title of [
    "Adele - Hello (Official Music Video)",
    "Adele - Hello official audio",
    "Adele - Hello [lyrics]",
    "Adele - Hello (M/V)",
    "Adele - Hello Topic",
    "Adele - Hello single",
  ]) {
    assert.equal(songVerdict(track({ source: "chrome.exe", title, album: "" })), "music-evidence", title);
    assert.equal(looksLikeSong(track({ source: "chrome.exe", title, album: "" })), true, title);
  }
  assert.equal(songVerdict(track({ source: "chrome.exe", title: "Adele - Hello", album: "25" })), "music-evidence");
  assert.equal(songVerdict(track({ source: "chrome.exe", title: "Adele - Hello", duration: 12 * 60, album: "" })), "music-evidence");
});

test("browser video override accepts otherwise ordinary videos", () => {
  // No length: a video, unless the setting says videos may show words too.
  const video = track({ source: "chrome.exe", title: "Some song", album: "", duration: 0 });
  assert.equal(looksLikeSong(video), false);
  assert.equal(looksLikeSong(video, true), true);
});

// ── The title ────────────────────────────────────────────────────────────────

test("a word that names a video in the title makes it a video", () => {
  const cases = [
    "Best of 2024 #shorts",
    "SEVENTEEN - HOT (reaction)",
    "Episode 12: the reunion",
    "The Full Movie",
    "Late night podcast, hour 3",
    "Mukbang: 10 pounds of noodles",
    "Final Highlights — Game 7",
    "Tutorial: mixing at home",
    "Best solos (compilation)",
    "Official Trailer",
  ];
  for (const title of cases) {
    assert.equal(songVerdict(track({ title })), "video-title", title);
    assert.equal(looksLikeSong(track({ title })), false, title);
  }
});

test("the title is matched without regard to case", () => {
  assert.equal(songVerdict(track({ title: "WEEKEND REACTION" })), "video-title");
  assert.equal(songVerdict(track({ title: "#Shorts — a moment" })), "video-title");
});

test("a video word inside another word is not a video", () => {
  // The words are matched as written, so only the real ones fire: a song is not
  // turned into a video by a coincidence of letters.
  assert.equal(songVerdict(track({ title: "Untrailed" })), "default");
  assert.equal(songVerdict(track({ title: "Dancing Queen" })), "default");
  assert.equal(songVerdict(track({ title: "Nightdrive" })), "default");
});

// ── The length ───────────────────────────────────────────────────────────────

test("a length no song has is not a song", () => {
  assert.equal(MIN_SONG_SECONDS, 45);
  assert.equal(MAX_SONG_SECONDS, 900);
  assert.equal(songVerdict(track({ duration: 30 })), "wrong-length");
  assert.equal(songVerdict(track({ duration: 44.9 })), "wrong-length");
  assert.equal(songVerdict(track({ duration: 15 * 60 + 1 })), "wrong-length");
  assert.equal(songVerdict(track({ duration: 3600 })), "wrong-length");
  // The bounds themselves are songs: a short interlude, a long live take.
  assert.equal(songVerdict(track({ duration: MIN_SONG_SECONDS })), "default");
  assert.equal(songVerdict(track({ duration: MAX_SONG_SECONDS })), "default");
});

test("a duration nobody reported does not turn a song into a video", () => {
  for (const duration of [0, null, undefined, Number.NaN, -5]) {
    assert.equal(songVerdict(track({ duration })), "default", String(duration));
    assert.equal(looksLikeSong(track({ duration })), true, String(duration));
  }
});

// ── A Spotify id ─────────────────────────────────────────────────────────────

test("a Spotify id is a song even when the program name is unknown", () => {
  // 22 base62 characters after the type, as the player gives them.
  assert.equal(songVerdict(track({ id: "spotify:track:6rqhFgbbKwnb9MLmUQDhG6", source: "something.exe" })), "spotify-id");
  // An episode is the player's own podcast: still worth words when it has any.
  assert.equal(looksLikeSong(track({ id: "spotify:episode:512ojhOuo1ktJprKbVcKyQ" })), true);
  // An ad never reaches this function (isAd runs first), but it must not crash.
  assert.equal(typeof songVerdict(track({ id: "spotify:ad:abc" })), "string");
});

test("an id that only looks like a Spotify id is not one", () => {
  // No length, so the browser rules decide and there is no music evidence.
  assert.equal(songVerdict(track({ id: "6rqhFgbbKwnb9MLmUQDhG6", source: "chrome.exe", duration: 0 })), "browser-video");
  assert.equal(songVerdict(track({ id: "spotify:track:short", source: "chrome.exe", duration: 0 })), "browser-video");
});

// ── Nothing at all ───────────────────────────────────────────────────────────

test("no track is not a song", () => {
  assert.equal(looksLikeSong(null), false);
  assert.equal(looksLikeSong(undefined), false);
  assert.equal(songVerdict(null), "video-title");
});

// ── A page that plays YouTube and YouTube Music both ─────────────────────────
//
// Read live from this machine: the session reported the title of an ordinary
// video, the channel as the artist, and no album and no length. The source was
// an opaque app user model id, which is why the browser rules never ran and the
// video read as a song.

/** What Rust sends now: the executable that owns the session, not the raw id. */
const page = (o = {}) => track({ source: "firefox.exe", artist: "Quick Fact Room", album: "", duration: 0, ...o });

test("a YouTube page with no evidence of music is not a song", () => {
  const video = page({ title: "That's an Insane Amount of Chili!" });
  assert.equal(songVerdict(video), "browser-video");
  assert.equal(looksLikeSong(video), false);
});

test("the same page playing YouTube Music is a song", () => {
  // YouTube Music names the record as the album; an ordinary video names none.
  const music = page({ title: "Voyaging Star's Farewell", artist: "Wuthering Waves", album: "Voyaging Star's Farewell", duration: 225 });
  assert.equal(songVerdict(music), "music-evidence");
  assert.equal(looksLikeSong(music), true);
});

test("a YouTube Short is not a song, and a video's own words still win", () => {
  assert.equal(songVerdict(page({ title: "Blade Got A New Weapon #hsr", duration: 30 })), "wrong-length");
  assert.equal(songVerdict(page({ title: "SPY×FAMILY Episode 1 Reaction Mashup", duration: 300 })), "video-title");
});

test("an opaque source id is read as a browser, not as a player", () => {
  // Before the id is resolved to a name it still arrives sometimes: the lookup
  // found nothing. It must not read as a song.
  const unresolved = track({ source: "308046B0AF4A39CB", artist: "Quick Fact Room", album: "", duration: 0, title: "That's an Insane Amount of Chili!" });
  assert.equal(songVerdict(unresolved), "browser-video");
  assert.equal(looksLikeSong(unresolved), false);
  // A player we know is still a player, whatever its id looks like.
  assert.equal(songVerdict(track({ source: "Spotify.exe" })), "music-source");
});

test("the name Windows registers for the id is what the rules read", () => {
  // Rust resolves the id to this registry DisplayName: "Mozilla Firefox".
  const video = track({ source: "Mozilla Firefox", artist: "Quick Fact Room", album: "", duration: 0, title: "That's an Insane Amount of Chili!" });
  assert.equal(songVerdict(video), "browser-video");
  assert.equal(looksLikeSong(video), false);
  // And the same program playing YouTube Music has the record as its album.
  const music = { ...video, title: "Voyaging Star's Farewell", artist: "Wuthering Waves", album: "Voyaging Star's Farewell", duration: 225 };
  assert.equal(songVerdict(music), "music-evidence");
  assert.equal(looksLikeSong(music), true);
});

// ── A feed app's own session ─────────────────────────────────────────────────

/** What Instagram publishes while a clip plays: the app's name, nothing else. */
const feed = (o = {}) => track({
  id: "spotify:track:9a1b2c3d4e5f6071",
  title: "Instagram",
  artist: "",
  album: "",
  duration: 0,
  source: "Instagram.exe",
  ...o,
});

test("scrolling Instagram is not a song, whatever the player reports", () => {
  // This is what put a lyrics pill on screen for a photo feed: the title was the
  // app's own name, with no artist, album or length to say otherwise.
  assert.equal(songVerdict(feed()), "feed-app");
  assert.equal(looksLikeSong(feed()), false);
  // "Show lyrics for videos too" must not bring it back: a feed is not a concert.
  assert.equal(looksLikeSong(feed(), true), false);
});

test("the other feeds are the same, and so is a name followed by its screen", () => {
  for (const title of ["Instagram", "TikTok", "Facebook", "Twitter", "Snapchat", "Threads", "Reddit"]) {
    assert.equal(songVerdict(feed({ title })), "feed-app", title);
    assert.equal(looksLikeSong(feed({ title })), false, title);
  }
  for (const title of ["Instagram — Reels", "TikTok | For You", "Facebook: Video"]) {
    assert.equal(songVerdict(feed({ title })), "feed-app", title);
  }
  // Case and stray spacing are not a way out.
  assert.equal(songVerdict(feed({ title: "  instagram  " })), "feed-app");
});

test("feed metadata never turns a feed session into a song", () => {
  // An app may populate artist or album with its own collection metadata, and a
  // clip knows its own length. The source is still a feed session, not a player.
  assert.equal(looksLikeSong(feed({ title: "Threads", artist: "Now, Now" })), false);
  assert.equal(looksLikeSong(feed({ title: "Instagram", album: "Album" })), false);
  assert.equal(songVerdict(feed({ title: "Instagram", duration: 210 })), "feed-app");
  // Whatever the title says, a feed's session is never a song — not even an
  // "official audio" clip, because scrolling a feed is not watching a concert.
  assert.equal(songVerdict(feed({ title: "Instagram (Official Audio)" })), "feed-app");
});

test("a feed name inside a longer title on a feed's own session is still a video", () => {
  // The source is still Instagram, so the session is a feed's whatever the
  // title: it never opens a card. (A song named after a feed, playing in a
  // player, is not this case.)
  assert.equal(songVerdict(feed({ title: "Instagram Eyes" })), "feed-app");
  assert.equal(songVerdict(feed({ title: "Reddit Girl" })), "feed-app");
  // In an ordinary browser, the same titles are just videos with no music.
  assert.equal(songVerdict(track({ source: "chrome.exe", title: "Instagram Eyes", album: "", duration: 0 })), "browser-video");
  assert.equal(songVerdict(track({ source: "chrome.exe", title: "Reddit Girl", album: "", duration: 0 })), "browser-video");
});

test("the verdicts that pass are exactly the ones a card is shown for", () => {
  const pass = ["music-source", "spotify-id", "music-evidence", "default"];
  const fail = ["video-title", "wrong-length", "browser-video", "feed-app"];
  const sample = (verdict) =>
    ({
      "music-source": track({ source: "Spotify.exe" }),
      "spotify-id": track({ id: "spotify:track:6rqhFgbbKwnb9MLmUQDhG6", source: "x.exe" }),
      default: track(),
      "music-evidence": track({ source: "chrome.exe", title: "Artist - Song", album: "", duration: 210 }),
      "browser-video": track({ source: "chrome.exe", title: "Some song", album: "", duration: 0 }),
      "video-title": track({ title: "Official Trailer" }),
      "wrong-length": track({ duration: 3 }),
      "feed-app": track({ source: "Instagram.exe", title: "Instagram", artist: "", album: "", duration: 0 }),
    })[verdict];
  for (const verdict of pass) assert.equal(looksLikeSong(sample(verdict)), true, verdict);
  for (const verdict of fail) assert.equal(looksLikeSong(sample(verdict)), false, verdict);
});
