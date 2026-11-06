# Changelog — Kanon

## Unreleased

### No console window, in a debug build too

- `windows_subsystem = "windows"` used to be gated on `not(debug_assertions)`, so a debug build opened a console window on every start. It now applies to every build; a debug run that wants the log back sets `MIKU_CONSOLE=1`, which attaches to the terminal that started it (`AttachConsole`) instead of opening a window of its own.

### Active pills: a list over the cap no longer locks the page

- `sanitizeDeclared` now enforces `MAX_DECLARED` (4). A `settings.json` holding five declared pills — written by hand, or by an older build — used to be read as it was: Settings → Active pills then read "5/4 slots in use" and disabled **every** switch that was not already on, so no pill could be added (ZCode's included). The list is now cut to the cap on load, which is what makes the page usable again.
- The page also names the pills that hold its slots but are not listed on it (the services, declared in Integrations), and a switch clicked while full says why instead of doing nothing.
- Covered by a test with a real five-entry list.

### ZCode: a coding tool you can make the main pill

- `agent_zcode` moved from the Agents category to Where you code, so it appears in Settings → Active pills → Main tool next to Claude Code, Cursor, Antigravity and Codex. The Mac's catalog has no ZCode pill, so this is Windows' own entry.

### ZCode agent integration

- Added **ZCode** to Settings → Agents and the agent pill catalog (`agent_zcode`), and to Settings search (both the Agents section and Your AI subscriptions).
- Miku can preview, install, and uninstall ZCode process hooks in `~/.zcode/cli/config.json` without replacing the user's plugins, MCP servers, or existing hooks. The hook uses argv directly, forwards `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, and `Stop`, and preserves the user's watchdog Stop hook.
- Installing also writes `hooks.enabled: true`: ZCode runs no hook at all while that flag is off, so the entry would otherwise never fire. Uninstalling removes only Miku's entries and leaves the flag alone rather than guessing what it was.
- ZCode hooks are read when a new task starts; existing tasks keep their current hook set. The relay is fire-and-forget and does not answer permission requests on ZCode's behalf.
- Covered by Rust tests that round-trip a config shaped like a real one (a `Stop` watchdog, `plugins`, `mcp`): the user's entries come back byte-identical after uninstall, and installing twice leaves one entry per event.

### ZCode in the chat, on your subscription

- Added **ZCode** to Settings → Chat → Your AI subscriptions (`cli_relay.rs`). It has no API-key mode, so the row is subscription-only, like Cursor's and Copilot's: the chat is answered by `zcode --prompt`, signed in with the account the CLI already has.
- Each turn runs headless in plan mode — `--output-format json --mode plan --no-color` — and the prompt goes in as an argument, because the CLI has no stdin mode. A dropped file is read with no web at all (`--disallowed-tools "WebSearch WebFetch"`), as for Gemini.
- ZCode has no `--model` option: the model is the one chosen inside the tool, so the picker's chip names the tool alone.
- The answer is the `response` field of the CLI's JSON. A turn whose `projection.status` is `error` or `failed` says why, or falls back to the last line of stderr; a signed-out CLI is reported with the command to fix it (`zcode login`).
- Covered by tests for the command line, both JSON shapes (the CLI indents its output over several lines), the failure paths and the switch.

### Lyrics: on from the first launch, in the top pill

- `lyrics.shown` now defaults to **on** (it was off), with `placement` still `island`: a song that starts draws its words in the compact island without anyone opening Settings first. Settings → General → Floating lyrics is where they are turned off.
- A `settings.json` written before `lyrics.placement` existed read it as `""`, which is neither surface: `lyricsInIsland()` said no and the pill stayed empty. `placement` is now normalised on load — missing, empty or unknown values read as `island`, and only `floating` is the other one.
- The Music pill is declared at launch when lyrics are on. The island draws lyrics from that pill's events, so without it there was nothing to draw at all, and auto-showing lyrics declared it only once a song had already started.
- The island no longer draws the pill before `build()` has made it: `State.subscribe` runs in the constructor, ahead of the DOM, and a report arriving then would have touched an undefined element.
- A track skipped to while another track's words were on the way cleared its own key and was never asked about again, leaving the pill blank for that song. The key is now reset so the next report asks.
- A words-less answer no longer sticks for the whole song. LRCLIB's `503` in busy minutes is retried after a 20 s cooldown instead of blanking the pill until the next track; a song it genuinely has no words for is left alone (the page already remembers the miss).

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
- Updater points at `FinDArata/Miku` releases (tags `windows-vX.Y.Z`)
- `LICENSE-ASSETS.md` rewritten for the fork; upstream history archived in [`docs/CHANGELOG-COUCOU.md`](docs/CHANGELOG-COUCOU.md)
- Pending: the Kanon mascot, app icon and sounds (the inherited Mochi character, icon and sounds stay © Louis Raillé and must not ship in distributed builds)

## History

Everything before 0.1.0 happened upstream, when this project was called Coucou:
see [docs/CHANGELOG-COUCOU.md](docs/CHANGELOG-COUCOU.md).
