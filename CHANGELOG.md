# Changelog — Kanon

## Unreleased

### MiniLyrics: only for songs

- The player's program now reaches the page (`Track.source`: Windows' app user model id, the MPRIS bus suffix on Linux), so a browser playing YouTube can be told from one playing YouTube Music.
- `src/lyrics/song.ts` decides whether a track is a song: a music player or a Spotify id is one; a title naming a video ("reaction", "podcast", "full movie", "#shorts", …) or a length under 45 s / over 15 min is not. Unit-tested as a full table.
- A video gets no lyrics card and no LRCLIB query; the card says "This is not a song" for the moment before it hides.

### Lyrics: a browser is not a music player

- Detection now classifies the source first. Music players and Spotify ids stay songs; **browsers need positive music evidence** — an "official audio/video/lyrics" marker, an `Artist - Title` shape under 12 minutes, or a non-empty album. A browser video with none of that is its own verdict: no card, no pill, no LRCLIB query.
- Video markers and an impossible length still win over every music hint.
- New setting **Show lyrics for videos too** (`lyricsVideos`, off by default) restores the old permissive behaviour.
- The pause grace period is cancelled when playback resumes, and declaring the Music pill automatically now emits `settings-changed` so a later save cannot undeclare it.

### Lyrics: Japanese kanji read as rōmaji

- `@sglkc/kuromoji` (IPADIC, Apache-2.0) is loaded lazily, only for a Japanese song: `私の心` → `watashinokokoro` instead of `私no心`.
- The dictionary is not in a JS chunk: a Vite plugin serves it in dev and copies the twelve `.dat.gz` files to `dist/dict/`. A failed load leaves the kanji as written.
- The song's language is decided from all its lines, so a kanji-only line in a Japanese song no longer gets Mandarin pinyin.

### Lyrics: in the top pill by default

- `lyrics.placement` (`island` default / `floating`) picks the surface; the floating window keeps its remembered spot and only appears for `floating`.
- The compact island grows to 440×96 with the previous, current and next lines, sharing the same romanisation and LRCLIB cache, and shrinks when the song stops or the pause grace runs out.
- Right-click the pill to detach it; the card's menu returns it to the top.

### Smarter lyrics search

- `clean_query` strips release tags from a title — `(Official MV)`, `[Lyrics]`, `【M/V】`, `(Color Coded Lyrics)` — inside out, and leaves a song's own parenthetical name alone.
- `lyrics_fetch` now tries `/get` exact, then `/search` with the artist, then `/search` with the title alone (a browser often reports the channel as the artist).
- The best search record is picked, not the first: synced words beat plain ones, and a record whose length is the track's own beats a different master. Instrumentals are never the answer.

### System pill

- New `integration_system` pill: CPU, memory and, on a laptop, the battery, read every three seconds with `sysinfo` (a new dependency, `system` + `multithread` only). Nothing leaves the computer, and polling stops when the pill is off.
- The card shows one gauge per figure, coloured calm → amber → red, with memory as "used / total GB".
- The battery is watched separately (once a minute, whatever the pill is doing), so Mochi can react to it.

### A living desktop Mochi

- `timeMood` gives him the hour: a morning greeting (once a day), a sleepy mood late at night, the odd yawn after lunch.
- `idleAntic` fills a quiet moment (90 s with nothing to do, then every 20–45 s) with a glance around, a wink, a proud pose or a yawn — never while dancing, asleep, paused or being dragged.
- The charger going in is a `love`, and the battery reaching 20% is a `surprised`: edges, so each happens once.

## 0.1.0 — unreleased

First Kanon release: a fork of [Coucou](https://github.com/Louis-CFM/coucou) by Louis Raillé (upstream 0.5.9), rebuilt as its own brand for Windows, Linux and Android.

- Rebrand Coucou → Kanon across the Windows/Linux app and the Android companion; app identifier `com.findarata.kanon`, product name `Kanon`
- Pairing protocol renamed on both sides: mDNS `_kanon._tcp`, QR scheme `kanon://pair`
- Agent hook binary renamed `kanon-hook`; named pipe `\\.\pipe\kanon-<sid>`
- Updater points at `FinDArata/kanon` releases (tags `windows-vX.Y.Z`)
- `LICENSE-ASSETS.md` rewritten for the fork; upstream history archived in [`docs/CHANGELOG-COUCOU.md`](docs/CHANGELOG-COUCOU.md)
- Pending: the Kanon mascot, app icon and sounds (the inherited Mochi character, icon and sounds stay © Louis Raillé and must not ship in distributed builds)

## History

Everything before 0.1.0 happened upstream, when this project was called Coucou:
see [docs/CHANGELOG-COUCOU.md](docs/CHANGELOG-COUCOU.md).
