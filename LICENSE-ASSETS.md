# Kanon — brand and artwork

Copyright (c) 2026 FinDArata. All rights reserved, except as stated below.

The [MIT License](LICENSE) covers the **source code** of this project. The **Kanon** brand — the name "Kanon" (花音 / カノン), its icon, character and sounds created for this fork — belongs to the fork owner.

## Character design note

The Kanon mascot is an **original chibi character drawn in code** (`windows/src/mochi/engine.ts`,
`windows/scripts/gen-icons.mjs`, `windows/scripts/gen-sounds.mjs`). Her design openly pays
homage to the "quiet swordgirl" archetype — most notably Mai Kawasumi (Key/Visual Arts'
*Kanon*) — through general traits only (dark blue hair, a back ribbon, green eyes, a red
dress and a katana). She is not a reproduction of any official artwork or character design,
which remain © Key/Visual Arts. This project is non-commercial, and the name "Kanon" is
used for its own meaning (花音, flower + sound; a musical canon) — it is not affiliated with
or endorsed by Key/Visual Arts.

## Inherited third-party assets

This repository is a fork of Coucou by Louis Raillé. The following assets from the
upstream project remain **© Louis Raillé** and are **not** covered by the Kanon brand
or the MIT License:

- the names "Coucou" and "Mochi", the Mochi character design, expressions and animations;
- the upstream app icon and menu bar icon (`NotchBuddy/Assets.xcassets/`);
- the upstream sounds (`NotchBuddy/Resources/sounds/`, copies in `android/app/src/main/res/`);
- the images, GIFs and videos in `docs/media/` and `design/`.

They are kept in this repository only because the platform code that was not
rebuilt still references them. They must not ship in any distributed Kanon build:
a distributed build needs its own icon, character and sounds (see the Kanon mascot
work in `windows/src/mochi/`).

## What you can do

- Build and run Kanon from this repository, for yourself.
- Fork it and contribute back with pull requests.

## What you can't do without written permission

- Publish or distribute a build using the inherited Coucou/Mochi assets listed above.
- Use the Kanon brand or the inherited assets commercially.

## Questions

Open an issue on [GitHub](https://github.com/FinDArata/kanon/issues).
