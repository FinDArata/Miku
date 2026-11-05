# Miku — brand, artwork and third-party characters

Copyright (c) 2026 FinDArata. All rights reserved, except as stated below.

The [MIT License](LICENSE) covers the **source code** of this project. The **Miku build's own
brand** — the name, the app icon and the sounds created for this fork — belongs to the fork
owner.

## Hatsune Miku

The mascot of this build is **Hatsune Miku**, drawn entirely in code
(`windows/src/mochi/engine.ts`, `windows/src/mochi/variants.ts`). The three looks are all
official Miku designs:

| Variant | What it is |
| --- | --- |
| **Miku** (classic) | Hatsune Miku's standard design: teal twin-tails, headset, grey pleated skirt, the "01" armband |
| **Snow Miku** | The winter design (pale blue-white hair, fur collar, snowflakes) |
| **Sakura Miku** | The spring design (pink hair, cherry-blossom ornaments) |

- **Hatsune Miku is © Crypton Future Media, INC.** She is used here under the
  [**Piapro Character License**](https://piapro.net/en_for_creators.html) (PCL).
- The Snow and Sakura variants are covered by the same licence: they are official Miku
  variants, not separate characters.
- The **chibi in this repository is an original drawing produced by this project's own
  code**. It is a derivative work of the character, not official artwork, and no official
  asset, illustration, model or recording is included or redistributed here.
- The app's icon (`windows/src-tauri/icons/`) is a render of that same code-drawn chibi, made
  by `windows/scripts/gen-icons.mjs`.

### What the Piapro Character License allows and forbids

The PCL permits non-commercial fan use of Miku, and forbids a few things this project must
respect. In particular, this build:

- is **non-commercial**: nothing here is sold, and no paid tier includes Miku;
- does **not** claim Miku as its own character, and credits Crypton as above;
- does **not** present itself as official, sponsored or endorsed by Crypton Future Media or
  by Crypton's partners.

**If you fork this repository and distribute a build, the PCL binds you too.** Read it
before you publish. The licence text is the authority; this section is only a summary.

## Inherited third-party assets

This repository is a fork of Coucou by Louis Raillé. The following assets from the
upstream project remain **© Louis Raillé** and are **not** covered by this build's brand
or the MIT License:

- the names "Coucou" and "Mochi", the Mochi character design, expressions and animations;
- the upstream app icon and menu bar icon (`NotchBuddy/Assets.xcassets/`);
- the upstream sounds (`NotchBuddy/Resources/sounds/`, copies in `android/app/src/main/res/`);
- the images, GIFs and videos in `docs/media/` and `design/`.

They are kept in this repository only because the platform code that was not
rebuilt still references them. They must not ship in any distributed Miku build:
a distributed build needs its own icon, character and sounds (see the mascot work in
`windows/src/mochi/`).

## What you can do

- Build and run Miku from this repository, for yourself.
- Fork it and contribute back with pull requests.

## What you can't do without written permission

- Publish or distribute a build using the inherited Coucou/Mochi assets listed above.
- Use the Miku build's own brand or the inherited assets commercially.
- Anything the Piapro Character License forbids for Hatsune Miku.

## Questions

Open an issue on [GitHub](https://github.com/FinDArata/kanon/issues).
