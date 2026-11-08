# Miku — guide for AI coding agents

Miku is a fork of **Coucou** by Louis Raillé, rebranded and maintained by FinDArata. The product focus is the Tauri app in `windows/` (Windows **and** Linux). The original macOS code (`NotchBuddy/`) and Apple-only pieces (`relay/`, `Casks/`, root `scripts/` and `tests/`) still carry upstream names, are not built on this machine, and stay untouched.

The mascot is **Hatsune Miku**, drawn in code (`windows/src/mochi/engine.ts` + `variants.ts`), in three official looks: classic, Snow and Sakura. She is © Crypton Future Media, INC., used under the Piapro Character License: this build is non-commercial and must not imply endorsement. The upstream Coucou/Mochi assets are still in the tree for the un-rebuilt platforms and remain © Louis Raillé — never ship them in a distributed Miku build. See `LICENSE-ASSETS.md`.

## Where things are
- `windows/` — the Tauri app for Windows and Linux: Rust in `src-tauri/`, TypeScript in `src/`, the `miku-hook` relay in `hook/`. Brand: `productName: "Miku"`, identifier `com.findarata.kanon` (kept: the keychain and the installer's upgrade path are keyed on it). The updater points at `FinDArata/Miku` releases (tags `windows-vX.Y.Z`).
- `windows/src/mochi/` — the mascot. `engine.ts` draws her, `variants.ts` holds the three palettes and the seasonal rule, `wardrobe.ts` resolves the outfit and the variant from the settings.
- `windows/src/core/pills.ts` — the pill catalog. Pill IDs are stable contract values (stored settings, hook routing): **never rename an existing pill ID**.
- `windows/src-tauri/src/pipe.rs` and `windows/hook/src/win.rs` must agree on the named pipe `\\.\pipe\miku-<sid>`.
- `docs/*.md` — behaviour and integration docs. `docs/*.html` — the site; operator identity fields are marked TODO.
- `docs/CHANGELOG-COUCOU.md` — the upstream project's history. New work is logged in `CHANGELOG.md`.

## Build
```
cd windows && npm install && npm run tauri dev
```
Frontend only: `npm run build` (tsc + vite). Unit tests: `npm test`. The icon set is generated from the mascot itself (`node scripts/gen-icons.mjs`, needs Chrome/Edge and starts its own vite). The i18n test passes: `scripts/gen-strings.mjs` applies the brand map (`BRAND`) to the Mac's catalog on the way out, and `scripts/rebrand-extra.mjs` / `rebrand-source.mjs` keep the hand-written table and the `t("…")` call sites in step. Add a string in English first, then translate it in `extra.json`.
Rust checks: `cargo check` in `windows/src-tauri/` and `windows/hook/`.

## Rules
- Secrets live in Windows Credential Manager / Linux Secret Service, never on disk or in git.
- No telemetry. Network calls only to services the user configured (plus the anonymous GitHub releases check for updates).
- Never block Claude Code (or any agent): if the app doesn't answer, the hook exits immediately.
- Never overwrite `~/.claude/settings.json`: dated backup, merge, show the diff, write only after the user confirms.
- Never send an email or approve an agent permission without an explicit click.
- Every Miku release adds a `CHANGELOG.md` section and a What's new entry in `windows/src/whats-new/whats-new.json` (14 languages; `npm test` checks it).
