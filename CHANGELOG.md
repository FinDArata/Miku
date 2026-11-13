# Changelog — Kanon

## Unreleased

### The launch greeting is a live stage

- Miku no longer drops in, bounces and slides aside the way the old marshmallow did. The footlights come on from left to right, a spotlight falls on her mark, and she rises through the stage floor on a lift, waves to the crowd, and watches her name light up karaoke-style beside her.
- Classic Miku is surrounded by notes; Snow gets falling snowflakes and Sakura falling petals, all in her skin's light.
- She ends with a small bow and one pulse of the footlights, about a second sooner than before (3.45 s instead of 4.6 s), then settles in the compact island as usual.

### The open island is her stage too

- Opened, the island is no longer a plain black box: it is lit from above in the skin's colour, with a row of footlights breathing along its front edge. Closed, it keeps the notch's black.
- The tabs sit in one track, the open one lit in the skin's colour; the header icons light up the same way on hover, and the close button turns red.
- Cards are glass instead of grey slabs. On the overview, a spotlight falls where Miku stands, and the agents sit on an LED grid as channel strips, each with its colour as a lit bar, glowing in that colour on hover.
- Primary buttons wear the skin's colour, and views come up from below the way she does, instead of zooming in.
- The overview is one stage across the whole island instead of two side-by-side cards: Miku on her mark, and one pill's slide beside her. A pager in the header (a dot per slide, in its colour, plus ‹ ›) shows where you are; swipe sideways on a trackpad, drag the stage, or press ← / → to move. A slide that wants a look rings its dot in the badge's colour.
- **Edit** in the pager lists every pill that can have a slide, the ones on first: click to switch one on or off (the same four slots as Settings, saved right away). Escape or the check mark ends it.
- A pill's own slide reads like a title card: what kind of pill it is in small spaced capitals in its colour, its name large, then its state as a chip and what can be done as capsules on one line.
- Changing slides has its own sound, `slide`: two glassy notes a fifth apart, like a music box turning a page, synthesised in `gen-sounds.mjs`. It is the 30th sound, and like the others it can be replaced by a file of your own.
- The launch greeting says hello out loud, a different line each time, picked at random from three: "待ってたよ！", "今日もよろしくね！" and "一緒にがんばろうね！". They are spoken by VOICEVOX:四国めたん, pitched up, and never say her name (the voice is not Miku's and must not pass for it), and committed in `windows/voice/` (`scripts/voice-cues.mjs --only=greeting-` renders them again).

### Miku's rooms wear Miku: the hub and the pill, redrawn

- The hub is rebuilt around a **Home** page: one card per thing (dictation, agents, integrations, the chat's model, OK Miku) and a way into each page from it. The sidebar's active row carries a teal bar, the brand is a teal gradient, and pages arrive with a short fade instead of a jump.
- The pill wears the same colours: a thin capsule that breathes teal while resting, controls that arrive one after another when it opens, teal audio bars, and teal buttons and bubbles.
- The bands on top of each page keep their page's colour, but the particles and the two waves along their floor now mix Miku's teal and follow the dictation level.

### Skins: the wardrobe paints the whole window

- The wardrobe's choice of Miku — classic, Snow, Sakura, or the season's — is now the interface's theme, not only her hair. Each skin is its accent plus the surfaces and text derived from it, handed to the stylesheets as `--skin-*` properties, so the hub, the pill and the island's small accents change together and fade between colours instead of snapping.
- The accent of each skin is that Miku's tie, straight from her palette, so the window and the character can never disagree about which skin is on.
- The skin is remembered across launches, so the window opens in its own colour rather than flashing the default first.
- A **Wardrobe** page in the hub shows the three Miku side by side with Miku herself as the preview; hovering one tries it on every window, clicking keeps it. Home carries a Skin card with the same way in.
- Trying a skin on never writes it down: a hover is not a choice.

### Outfits are drawn on Miku again

- Outfits had been switched off wholesale when Miku was redrawn as a chibi: their anchors still described the old round Mochi head, so a hat would have floated. The anchors now follow her own head — the hair cap at (150, 64), 88×80 — and the party hat, the witch hat and the crown sit on her crown.
- The preview leaves room above the character for the tall hats, which were having their tips cut off by the canvas.
- Covered by tests that record the drawing calls: they fail if outfits are ever switched off again.

### Cheaper frames, same picture

- The body outline and the gradients (back hair, the two twin-tails, the skirt, the irises) are made once per variant and canvas instead of every frame; the outline is rebuilt only while the mailbox morph is running, and the iris gradients are kept per rounded gaze.
- The chat's streaming answer is drawn once a frame instead of once per token, and only its last block is rebuilt: the blocks above it are already final in a stream.
- A compact island with mini bots no longer stops its frame loop. Their engines breathe on their own and are not the island's engine, so the loop used to stop between their frames and leave them frozen mid-breath.
- The lyrics pill redraws and romanizes only when the line changes, as the full lyrics card already did; the words of a line are kept once romanized.
- Colour strings (`rgba(…)`) are cached, the bot glow writes no style when nothing changed, and every canvas — Mochi's, the mini bots', the pill's, the measuring one — keeps its drawing context instead of asking for it per frame.

### Background work: less disk, fewer wakeups

- `settings.json` saves are debounced: a burst of changes writes at most once a second, the latest snapshot winning, through the same temp-write/fsync/rename. Dragging Mochi across the desktop or moving a settings control no longer costs one full serialization and fsync per event. A save that must be on disk before it returns (installing hooks) still writes at once, and quitting flushes whatever is pending.
- `miku.log` keeps one open handle and rotates to `miku.log.1` past 1 MB instead of deleting the history.
- Integration pollers now live and die with their pills: switched off, their tasks are cancelled instead of waking every 15–300 s only to decline the work. GitHub's pulse and activity loops follow the same rule.
- Every poller shares one `reqwest` client, so its connection pool and TLS sessions survive between ticks; the forges keep a separate no-redirect client for their tokens.
- The pipe relay searches only the bytes that just arrived for the newline that ends a payload, instead of rescanning the whole buffer per chunk — large diffs no longer read quadratically (app and hook alike).
- The hook reads its own SID once per process, `cli_candidates` caches found CLIs (an empty answer is retried), the Outlook process check is cached for two seconds, and Codex's app-server is given a moment to exit on its own before the whole tree is killed.

### Build

- The generated sounds are 22.05 kHz instead of 44.1: the chimes are quiet and sit under 1 kHz, so the installer carries about 1.1 MB less with nothing audible lost.
- `predev`/`prebuild` rebuild the release hook only when `hook/` (or the workspace manifests) is newer than the binary, instead of relinking an LTO binary on every run.

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
