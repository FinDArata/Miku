# Kanon — guide for AI coding agents

Kanon is a fork of **Coucou** by Louis Raillé, rebranded and maintained by FinDArata. The product focus is the Tauri app in `windows/` (Windows **and** Linux) plus the Android companion in `android/`. The original macOS code (`NotchBuddy/`) and Apple-only pieces (`relay/`, `Casks/`, root `scripts/` and `tests/`) still carry upstream names, are not built on this machine, and stay untouched.

The character (Mochi design, drawn in code), the app icon and the sounds still come from upstream and remain © Louis Raillé — never ship them in a distributed Kanon build. The Kanon mascot, icon and sounds are a pending work phase (see `LICENSE-ASSETS.md`).

## Where things are
- `windows/` — the Tauri app for Windows and Linux: Rust in `src-tauri/`, TypeScript in `src/`, the `kanon-hook` relay in `hook/`. Brand: `productName: "Kanon"`, identifier `com.findarata.kanon`. The updater points at `FinDArata/kanon` releases (tags `windows-vX.Y.Z`).
- `windows/src/core/pills.ts` — the pill catalog. Pill IDs are stable contract values (stored settings, hook routing): **never rename an existing pill ID**.
- Phone link: mDNS `_kanon._tcp` and the `kanon://pair` QR scheme are cross-side contracts with `android/` (`android/app/src/main/kotlin/com/findarata/kanon/link/`). Change both sides together, always.
- `windows/src-tauri/src/pipe.rs` and `windows/hook/src/win.rs` must agree on the named pipe `\\.\pipe\kanon-<sid>`.
- `android/` — the Android companion, package `com.findarata.kanon`, pairs with the desktop over Wi-Fi (QR + pinned certificate).
- `docs/*.md` — behaviour and integration docs. `docs/*.html` — the site; operator identity fields are marked TODO.
- `docs/CHANGELOG-COUCOU.md` — the upstream project's history. New work is logged in `CHANGELOG.md`.

## Build
```
cd windows && npm install && npm run tauri dev
```
Frontend only: `npm run build` (tsc + vite). Unit tests: `npm test`. One test (`i18n.test.mjs`) intentionally fails while the upstream Mac catalog is still present.
Android: `cd android && ./gradlew assembleDebug` — set `JAVA_HOME` to Android Studio's JBR; `local.properties` holds `sdk.dir`.
Rust checks: `cargo check` in `windows/src-tauri/` and `windows/hook/`.

## Rules
- Secrets live in Windows Credential Manager / Linux Secret Service, never on disk or in git.
- No telemetry. Network calls only to services the user configured (plus the anonymous GitHub releases check for updates).
- Never block Claude Code (or any agent): if the app doesn't answer, the hook exits immediately.
- Never overwrite `~/.claude/settings.json`: dated backup, merge, show the diff, write only after the user confirms.
- Never send an email or approve an agent permission without an explicit click.
- Every Kanon release adds a `CHANGELOG.md` section and a What's new entry in `windows/src/whats-new/whats-new.json` (14 languages; `npm test` checks it).
