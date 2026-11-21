# Changelog — Miku

## 0.1.1 — 2026-11-21

### Miku opens as a hologram

- The launch greeting no longer follows the shape Miku inherited from Coucou (a card drops, the mascot pops up with her name beside her, the card shrinks back). There is no island at first: a projection disc lights up on the desktop, and Miku is rendered into its column of light slice by slice, feet to head, glitching in her variant's colour, until she is solid and holds her pose of the day among drifting 0/1 bits. Then she shrinks up into whatever the island folds to — the compact notch, the closed strip, or nothing when the closed island is off — and the island takes over exactly where she landed. The spoken hello is unchanged.
- The Miku window no longer opens along with Miku: "Open this window when you open Miku" is now off by default, and still in Settings for anyone who wants it.

### Her face in the notch

- The compact notch and the closed strip show Miku's face instead of her whole figure, which was a smudge at that size. Hats from the wardrobe keep their crown.

### She sulks when poked

- Three quick pokes no longer make her dizzy and swap the island for a pink "Too many hits" card. She sulks for three seconds in one of five new poses picked at random (pout with a puffed cheek, huff, sulk, stomp, glare), and the island keeps the view it had.
- On the open island a speech bubble pops over her head with one of six lines, and she says it out loud (spoken cues made with VOICEVOX:四国めたん). Pokes on the deck's own full-length Miku now reach her; before, they hit a hidden Miku behind it.

### No Coucou bubble at launch

- The blue "…" activity badge the old greeting drew at its end is gone.

## 0.1.0 — 2026-11-21

### A new face for the app

- The app icon is Miku's face now, not her whole figure: her head and the leek she holds up, on a teal rounded tile. The bust it replaced shrank to a smudge at taskbar sizes; the face and the tile still read at 16 px. It is still drawn by the mascot engine itself (`scripts/gen-icons.mjs`), in the leek pose, so the icon cannot drift from the Miku the app shows.

## 0.0.9 — 2026-11-20

### A card with nowhere to go presses the toast itself

- A chat card whose toast named no place to open — Discord writes none — no longer just opens the app as a whole. The click goes to the Notification Center, finds the toast by the title it read from its payload, and presses the card with a real click: the same activation a click on the toast itself performs, the one that lands in the chat it was shown for. Invoke and `DoDefaultAction` proved to be no-ops on these cards, so the press is the click. The center folds back down unless it was already open or the app took the front, and a toast that never shows falls back to opening the app.

### A launch that goes where the toast pointed

- A target an app itself wrote is now followed everywhere. `line://` targets were dropped before; a `discord.com` address becomes the app's own `discord://app/open#<route>` form; and the target reaches the toast card, the hanging messages card and the deck's notice history instead of only one of them.

### A README that shows the app

- The README now shows the app itself — the karaoke stage, the widget deck, the capsule and the agent notices — in screenshots that sit on a dark themed backdrop instead of a flat white.

### A door for contributors

- `CONTRIBUTING.md` tells a newcomer where the app lives, what to run before a pull request, and where the strings go; `LICENSE-ASSETS.md` draws the line between the MIT-licensed source and the Miku brand, and says plainly how the Hatsune Miku designs the build draws are used.

## 0.0.8 — 2026-11-19

### A relay that vouches for itself

- Every connection to the Windows relay pipe is checked against the user's SID before it may drive the island — the same rule the Linux relay always applied through `peer_cred()`. The pipe's own DACL is the creating account's default (SYSTEM, Administrators, the user — nobody else), the hook keeps its check of the server, and a pipe name that falls back to `USERNAME` says so in the log, on both ends.
- `pipe.rs` carries tests for the first time: the decision wait (ack, a decision that beats the ack, decline, both timeouts, a channel that closes), the pending-request map, and the one-payload reader (chunks, a stream without a newline, the size cap, a broken connection).
- One panic no longer lingers: the runtime `Mutex`es of the relay, Spotify, the desktop Mochi, the shortcuts, the settings and the island take a poisoned lock in stride instead of panicking forever after.
- A Discord or LINE toast whose app is already in front is never shown as unread — the toast that was clicked, or arrived while reading, no longer leaves a sign hanging after the message was read.

### An island that comes back

- A destroyed island window rebuilds itself with the same shape tauri.conf.json gives it: the approvals, the LINE / Discord notices and the agents page live there, and the hub was already the only one that healed. It stands down when the app is exiting.
- A killed WebView2 process that the environment restarts used to leave every page blank — a white hub, no island — with nothing to say it had happened. The pages heartbeat now, and a content watch destroys one gone silent: the island rebuilds itself at once, the hub at its next open.
- The LINE & Discord toggle hides on Linux, where there is no Windows notification store to read.

### A warmer welcome

- A brand-new install gets a hello card once: who Miku is, and the one setup worth doing, with a button that opens the Miku window. What's new keeps skipping first installs, as before.
- The wardrobe is reachable from Settings → General → Miku's look — it used to live behind the tray and `Ctrl+Alt+G`.
- Thai and Traditional Chinese join the picker: sixteen languages now, and a system set to a Traditional Chinese region reads 繁體中文 instead of English. Filling the catalog kept every existing translation intact (858 strings, none lost).
- The dance comment that claimed the desktop Mochi only dances on Linux is gone: the dance runs wherever the desktop Mochi does.

### A Miku called Miku everywhere

- The Windows README speaks of Miku with her name and her pronouns, the paths the code really uses (`miku-hook.exe`, `miku.sock`, `%LOCALAPPDATA%\Miku`, `~/.config/miku`), and the sixteen languages; the installer copyright says © FinDArata; docs/AGENTS.md's approval list and the relay's `miku_agent` tag match the code.

### Pages that are there before their answers are

- Hub pages paint at once; the island's deck keeps its pages. A hub page puts its band and tabs up the moment it is clicked — the sections' reads go out in one parallel batch instead of twenty-odd lined up in a row, and a page that cannot build leaves a note instead of standing blank. The deck mounts a page it has already built as it stands when the user comes back to it, with a small entrance that bows out when the system asks for less motion; a page already on screen still redraws its clocks and polls, its key asks the history's and the shelf's version counters instead of stringifying whole lists on every sync, and the canvases are sized only when their size actually changes.

### Romaji that reads the way a song sings it

- The readings a dictionary gets wrong in a lyric read right: 力 the dictionary tags as the "-ryoku" of a compound (魅力, 権力) is chikara here and stands as its own word — 悲しみ怒り力に変えて (CHEMISTRY's Period) came out "ikariryoku"; a compound verb the dictionary cut apart reads as one word again — 駆け巡る came out "kake meguru" — and 辿り着いた came out "ki" where 着る ("to wear") was stealing the reading; a word the song gave a reading of its own (ずっと側で) never glues onto the word before it, while こちら側 keeps its gawa. The notice cards' romaji line shares the fix.

## 0.0.7 — 2026-11-18

### The same Miku, drawn for less

- Her colours and canvas gradients are built once and reused instead of rebuilt every frame for every drawn Miku — the island, the minis, the deck and the stage threw away thousands of strings and objects a second for values that never change. Her frames iterate their tweens and particles in place, and the per-frame lookups of the day's season are asked twice a minute at most.
- The deck's pages, the hanging sign, the header icons and the lyrics header rebuild only when their content actually changed, not on every state event; style writes that repeat the last frame's values are skipped, and the stage's clock writes once a second instead of five.
- Identical Spotify reports no longer wake the island's DOM, and the canvas contexts every painter asked for each frame are found in a WeakMap.

### A backend that stops repeating itself

- Music bands in silence went out to three windows about ninety times a second; now nothing moves on the wire until a level moves. Spotify reports, integration cards, the machine's health and the artwork skip an emission when the payload is byte-identical to the last one.
- One HTTP client per proxy class is shared by lyrics, weather, chat and the update check — one TLS handshake per host instead of one per request — and the PC notification watcher keeps its database connection between ticks instead of opening wpndatabase every three seconds.
- The lyrics spot saver sleeps until the window moves again, and a hook event's recap save runs off the async pool with its write order kept.

### A lighter launch

- The recap history (up to 16 MB) is parsed at first use instead of before the first window shows, and the hook-exe copy and the Credential-Manager sweep moved off the launch path.
- The what's-new file (97 KB) is parsed only when the card may show, not at every boot, and the lyrics cache is parsed once per window instead of on every song.

## 0.0.6 — 2026-11-18

### Permissions and questions come down from the notch

- An agent asking for permission no longer opens the island: a yellow card comes down from the notch, as the mockup draws it — who asks, the command (or file, or URL) in a mono box, Allow, Deny, Always and Later. A question comes the same way, its answers as pills (tick several and press Done), several questions one after the other, Answer in terminal.
- The card stays until it is answered. Later folds it: Miku hangs under the capsule with "needs permission" on her sign, and a click brings the card back. Other notices never cover it, and a queue shows "one more waiting".
- Opening the deck while a request waits moves the card aside; closing the deck brings it back. A new request folds an open deck.
- A fresh card ignores clicks for its first 600 ms, so a click meant for another window never lands on Allow. Always still only stops that tool from asking again; the request on screen still waits for Allow.
- A question with nothing to pick from gets its own card: answer it in the terminal, with a button to open it.

### A pose of her own on each page of the deck

- On the PC page Miku types at her laptop while the machine is calm, thinks with a hand on her chin once it gets busy (CPU from 60 % or RAM from 80 %), and goes dizzy when it strains (CPU from 85 % or RAM from 90 %).
- Music: she holds her leek while nothing plays, and sings when a song does. Focus: proud before a round, thinking while it runs, yawning on the break. Agents: a peace sign while none is working.

### What's new comes down from the notch

- The card after an update is a notice from the notch now, not a page in the island: ♪ What's new, the version, what it brings as small chips, OK and All changes.
- Coucou's leftovers are gone: the "Your Miku so far" page and its Buy Miku a coffee button (and the site's Support development button), which led to Coucou's own Stripe page, and the What's new entries of Coucou's releases.

## 0.0.5 — 2026-11-18

### Word-by-word karaoke

- NetEase Cloud Music is now the first lyrics source: its lyrics are timed word by word, so each word lights up as it is sung. Settings → Lyrics turns it off; LRCLIB stays the fallback for any song NetEase does not have.
- A Korean, Japanese or Chinese song prefers lyrics in its own script over a translation; a bracketed alias ("연애의 조건 (Love Options)", "BESTie(베스티)") names the song and the singer.
- A line timed only as a whole fills over the time its syllables take at the song's pace, so a break with no blank stamp no longer drags the wipe. A word held longer than 5 s with a music break folded in fills where the voice is, instead of glowing through the music.
- The lyrics show on Lock to top as soon as words land, take the lyrics text colour in the island, and a wrapped line fills its first row, then its second.

### Songs a browser plays find their words

- A video title that wraps the song's name — 『鳴潮』先取ラジオEP3.0──モーニエ「Unwritten in the Stars(星々に触れられるなら)」, 《予以明日的花束 A Bouquet for Tomorrow》 — no longer hides it from NetEase and LRCLIB: the names inside the title (the quoted one first) are asked for as well, so the song under the wrapper is found.
- NetEase's own filing of a song counts: "Unwritten in the Stars（若能触及群星）" is "Unwritten in the Stars" — an alias in another script is the same song, while "(Remix)" and "（Instrumental）" still are not.
- A record only the length vouches for is refused: a stranger's "Paperplane" (238 s) no longer sings for a game's "Paper Plane" — LRCLIB's credited answer beats it.
- Full-width and corner brackets (（）「」『》) and quotation marks ("Paper Plane") are read as brackets, where only ()[]【】 were before.
- A song asked for and missed before the ask got this smart is asked again (the remember-nothing list starts fresh).

### Lyrics during an instrumental break

- A long stretch of music alone — a long intro, an interlude, a break folded into a word of a NetEase lyric — shows a small "♪ …" in the lyric's place instead of a line that sits lit or sings over the music. A pause of seconds keeps the line where it was; past five, the music takes over, and the words come back with the voice.
- NetEase's and LRCLIB's "instrumental, please enjoy" placeholders (纯音乐，请欣赏, "Instrumental", a lone ♪) are no longer sung: they mark the break as a gap, saying nothing.
- A break's span no longer sets the pace every line is sung at, so a line no longer crawls slowly through the music that follows it.

### Kanji read more of what the song says

- A Japanese song is Japanese however many of its lines are kanji-only: one kana settles it, so kanji-heavy songs are romanised again instead of being mistaken for Mandarin and left as written.
- A word the dictionary has no reading for is read kanji by kanji (a table of a few hundred common kanji), instead of leaving the kanji in the middle of the rōmaji.
- Half-width katakana (ｶﾞ, ﾊﾟｰﾄﾞ) widens and reads like its full-width self.
- A lyric reading (二人 as futari, 側 as soba after の, …) is matched at the word it belongs to: 一人称 keeps its own reading, and a word built on the same kanji in another song is never rewritten.

### Notices fold away when read

- Opening Discord (or LINE) itself counts as reading its messages: the unread sign under the capsule folds away on its own, and the Notif page marks them read — no click needed. Windows sends no receipt back, so the app in front is the signal.
- A finished agent's notice does the same: the Claude app, an editor or a terminal in front counts as seeing it, and its card and hanging sign fold away.
- If a chat app ever writes in its toast where a click should lead (Discord writes none today), the island follows it and opens that chat instead of the app as a whole.

## 0.0.4 — 2026-11-16

### Karaoke lyrics

- The line being sung in the floating lyrics fills with teal from left to right, in time with the song, and stops when the song is paused. Lyrics without timing stay as they were.

### New versions come down from the notch

- A new Miku now arrives as a notice card under the notch, like a message, instead of opening the island: old → new version, the release's headline, Update now · What's new · Later. Update now shows the download's progress right on the card.
- Folded away, Miku hangs under the capsule with the version on her sign (and the download's percent while it runs); a click brings the card back. Later hides her until the next day.
- Asked for from the tray or Settings, the island still opens on the update as before.

### Cleaner notice cards

- The black frame around a notice card is gone: the card and Miku float over the screen.

## 0.0.3 — 2026-11-16

### A sound for each kind of notice

- Settings → General → Notice sounds: LINE, WhatsApp, Discord, the agents and the other notices each pick their own sound — Miku's usual one, none, another of hers, or a file of yours (Choose file… copies it into the sounds folder). ▶ plays it.
- LINE and Discord notices now ring at all (they were silent).
- By default Miku says who rang, in her own voice: ラインきたよ！, ワッツアップきたよ！, ディスコードきたよ！, お知らせだよ！ for the other notices, and the agent's name when one finishes (クロード、できたよ！, Codex, Cursor, Gemini, Copilot, or エージェント for the rest).

### Miku speaks more

- New spoken cues: a permission card (これ、いいかな？), a rate limit (ちょっと休憩だって), a prompt sent (はじめるね！), being petted (えへへ), shaken (目が回る〜), poked (もう〜！) or slapped (いたっ！), a break reminder (ちょっと休もうか？), a file caught on the Shelf (キャッチ！), a new version (新しいバージョンだよ！), and こんばんは！ when Miku opens in the evening. メールきたよ！ is there to pick in Notice sounds.
- Every cue now uses the same voice (VOICEVOX:四国めたん), the six older ones included.

### Romaji, apart for lyrics and notices

- With romaji on, the floating lyrics show only the Latin line; the Japanese or Korean words are no longer repeated under it.
- Notices have their own switch, "Romaji under notices" in Settings → General, for the line under a Japanese or Korean message (card and Notif page).
- Kanji the dictionary read wrong are written as sung: 側 / 傍 (soba), 何て (nante), その後 (sono ato), 貴女, 其処, 如何して, 一番星, 秋桜, 蒲公英.

### Every island card on her stage

- The permission, question, error, finished, break, What's new, chat and wardrobe cards lose the upstream colour washes. A card is lit like the overview: a bar along its top and a spotlight on the floor where Miku stands, in teal, or pink when something went wrong.
- The weekly recap is a stage panel with its numbers on small tiles, and the image it shares is her stage at night: teal and pink spotlights, a glowing floor grid.
- With no queue behind a permission card, its empty counter pill no longer shows.
- The desktop Miku window is titled Miku, and the upstream Mochi and Kanon design files are gone from the repository.

### New versions show on the island

- The deck's top bar has an update chip when a new version is out (or its download percentage), and the Miku window's menu has an update button. Both open the update card; the bar scrolls sideways so Close always fits.

### Lyrics only for songs

- A video's length alone no longer makes it a song: the floating lyrics need music in the title, an album, or a music channel (Topic, VEVO). A YouTube Short no longer opens them.
- LRCLIB's search answers only for the very title with its singer or its length.
- The floating lyrics window has no shadow or border.

## 0.0.2 — 2026-11-16

### The main menu is a concert stage

- The Miku window's menu keeps its idea (Miku in the middle, the sections in an arc over her head) on a new stage: two spotlights from the rig in her colour and pink, a faint five-line staff across the hall, and a floor grid running away under her feet. The skins tint it all.
- Every bubble is now a small Miku with a face of her own and the page's prop: a house (Home), a dress (Wardrobe), a mic (Dictation), a notepad (Notetaker), a book (Words), a palette (Styles), a gear (Settings), a leek (The island) and a letter (Mail). She stays still until her bubble is hovered, then moves. The bubbles sit at equal steps along the arc, so the last two no longer overlap.
- Opening a page moves her to the left column in that bubble's pose, and she keeps it while the page is open, including when you switch pages from the chips or the search.
- The page panel is glass with a teal-to-pink rim; the section chips sit on one track with the open one lit, titles get an accent line, and cards a soft top light.

### Miku catches your files

- The upload view is gone: a file dropped on the island lands on the deck's Shelf page. Miku catches each one and holds it while its copy into the inbox runs, with a copy bar, then shelves it.
- The shelf lists what she caught (kept a week), opens a file, shows it in the file manager, drags it back out of the island, or takes it off.

### Messages ring her headset

- A message notice has her headset ring and the bubble drop into her hands. The notice card and the Notif page show each chat app's own mark.

## Unreleased

### Closing the Miku window asks first

- The window's X now asks whether to minimize Miku to the tray (the island, your agents and dictation keep running) or quit her. Escape or a click outside cancels; a second X while the question is up hides the window anyway, so it can never get stuck.
- Fixed: closing the Miku window on Windows left a white, empty copy of it on screen until it was opened again.

### The Apple apps are gone from the tree

- Miku is Windows and Linux first, with no Apple plans for now, so the upstream Mac app, iPhone app, widgets and notification extension are removed, with their assets, the iPhone Live Activity relay, the Homebrew cask, the Mac scripts and tests, the Mac CI and the iPhone pages of the site.
- The string catalog the translations come from now lives in `windows/src/i18n/Localizable.xcstrings`, and the What's new check in `windows/scripts/test-whats-new.py`.
- The site no longer offers a Mac download or Android companion: the home, support, privacy and terms pages describe the Windows and Linux app only.

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
