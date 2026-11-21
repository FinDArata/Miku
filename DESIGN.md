# Miku — design guide

Read this before any UI work: a new screen, a card, a mockup, an icon, an animation. Every piece of Miku's interface wears **the Miku style** below. Don't invent a new palette, font or look; reuse what's here and what the code already has.

## The idea in one line
A near-black, glassy desktop companion lit by **Hatsune Miku's teal** (`#39C5BB`), with Miku herself (the chibi drawn in code) as the star of the moment. Calm surfaces, one bright accent, bouncy motion, small playful touches (0/1 digits, sparkles, snowflakes, petals) that never get in the way.

## Colour

### The accent comes from the skin, never a hardcoded hex
The app has three skins, one per Miku variant. The accent is that Miku's **tie colour** (`src/theme/skins.ts`, from `src/mochi/variants.ts`), and every other shade is derived from it. In CSS always go through the variables:

| Variable | Use |
|---|---|
| `--miku` | the accent: active nav, filled buttons, dots, progress |
| `--miku-bright` | hover, the tip of an active bar, highlights |
| `--miku-deep` | borders, pressed states |
| `--miku-tint` | 12% fill: hovered rows, active pills |
| `--miku-line` | ~30% hairlines, focus rings |
| `--miku-glow` | soft glow / box-shadow around her or an active card |
| `--on-miku` | text on a filled accent button (near-black, tinted) |
| `--skin-panel` / `--skin-card` / `--skin-field` | surfaces, each a step lighter |
| `--skin-text` / `--skin-body` / `--skin-secondary` / `--skin-muted` | text tiers |
| `--skin-line` | hairline between surfaces |

For `rgba()` tints use `rgba(var(--skin-accent-rgb, 57, 197, 187), a)`. A literal `#39c5bb` is only allowed as the fallback after a `var()`, or in a dev mockup.

| Skin | Accent (tie) | Hair | When |
|---|---|---|---|
| Classic | `#39C5BB` | `#39C5BB` / dark `#249690` | default, May–Nov on auto |
| Snow | `#67ADE2` | `#E4EEF9` / dark `#ADC4E2` | Dec–Feb on auto |
| Sakura | `#EF7AA7` | `#F5A8C7` / dark `#E27FA5` | Mar–Apr on auto |

Anything you build must look right in **all three** skins. Check Snow especially: its accent is pale.

### Surfaces and text (base tokens in `src/style.css`)
- Always **dark** (`color-scheme: dark`). Surfaces are nearly black and only *lean* toward the accent hue by a few percent; the accent never becomes the background.
- Island card `--card #141518`, flat `--card-flat #0e0f11`, hairline `--hairline rgba(255,255,255,.035)`; the notch itself is `#050607`.
- Text: `--ink #f5f6f8` primary, then `--dim` → `--dim-5` for secondary/tertiary.
- Status colours (use only for status): `--red #f4505e` (text `--red-text #ff8d97`), `--green #22c55e`, `--amber #f5a524`, `--cyan`, `--indigo`, `--pink`. Brand colours of third-party services (WhatsApp `#25D366`, Spotify, etc.) only on their own pill.

## Type
- `--font` (system-ui / Segoe UI Variable / Noto stack with CJK, Devanagari, Bengali, Arabic fallbacks). Never import a web font: the stack has to cover all 16 UI languages.
- `--mono` (Cascadia Mono / Consolas) for code, diffs, paths, shortcuts.
- Small and dense, like the macOS island it comes from: body 12–13px, labels 11–11.5px, section titles 14px, weight 600 for headings. Big numbers (hero clock/stats) are the exception.

## Shape
- Pills and chips: `border-radius: 999px`. Dots, avatars, Miku's icon: `50%`.
- Cards 12px (hero/big panels 18px), buttons and fields 8px, small tags 4–6px, tiny bars 2px.
- Borders are hairlines (1px, low-alpha white or `--miku-line`), not heavy outlines. Depth comes from a step-lighter surface and a soft glow, not big drop shadows.

## Motion
- Bouncy, springy, short. The house easings:
  - `cubic-bezier(0.3, 1.2, 0.4, 1)`: the default overshoot (cards, pills appearing)
  - `cubic-bezier(0.34, 1.56, 0.64, 1)`: a bigger pop
  - `cubic-bezier(0.22, 1, 0.36, 1)`: smooth ease-out without overshoot (pages, slides)
- Idle life is subtle: breathe, bob, sway, twinkle, dot-pulse (see the `hub-*` keyframes in `src/hub/hub.css`). Reuse an existing keyframe before writing a new one.
- Respect `prefers-reduced-motion`: drop the bounce and loops, keep the state change.

## Miku herself
- Always the app's own chibi: `drawChibi` (`src/mochi/chibi.ts`) or the engine in `src/mochi/engine.ts`. **Never** official Crypton artwork, fan art, or the upstream Coucou/Mochi mascot assets.
- She is drawn on a `<canvas>` with the variant from the wardrobe (`src/mochi/wardrobe.ts`), so she always matches the skin.
- She has character: wink + peace, sulks when poked (five moods), says a line over her head, dances to music. Empty states, greetings and confirmations are where she shows up; a plain icon is the fallback, not the default.
- Signature motifs (sparingly): teal `0`/`1` digits (her "01"), the hologram/scanline look of the launch opening, sparkles; snowflakes for Snow, cherry petals for Sakura.

## Copy
- Product strings: English first, then translated in `extra.json` (see CLAUDE.md). Short, warm, a bit playful; Miku speaks in first person when she speaks.
- Licence: non-commercial, never imply endorsement by Crypton Future Media.

## Dev mockups (`windows/dev/*.html`)
The way new UI is proposed before it goes in the app. Follow the existing ones (e.g. `opening-mockup.html`, `notif-miku-mockup.html`):
- One self-contained HTML page, page background `#1b1b1f`, `main` max-width ~720px with 16px gutters, the Miku tokens re-declared at the top (`--teal #39c5bb; --ink #f2fbfa; --dim #8fa3b8`).
- Import the real code (`import { drawChibi } from "/src/mochi/chibi.ts"`) instead of redrawing Miku; open through vite at `/dev/<name>.html`.
- An `h1`, a short lead and a numbered list explaining the idea, **in Indonesian**; buttons (8px radius, `#2a2f36`, teal border when on) to replay, slow down, switch wallpaper (dark / light / colourful) and switch variant.

## Checklist before you call UI done
- [ ] Only `--miku*` / `--skin-*` / base tokens, no new stray hexes
- [ ] Looks right in Classic, Snow and Sakura
- [ ] Dark surfaces, one accent, hairline borders, house radii
- [ ] Motion uses the house easings and honours reduced motion
- [ ] Miku is the in-code chibi, never outside artwork
- [ ] Text fits in the longer languages (German, Russian) and in CJK
