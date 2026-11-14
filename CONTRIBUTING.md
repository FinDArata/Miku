# Contributing to Miku

## Getting started

The app lives in `windows/` (Windows and Linux, Tauri):

```bash
cd windows && npm install && npm run tauri dev
```

Before a pull request:

```bash
cd windows && npm run build && npm test
python3 windows/scripts/test-whats-new.py
```

Rust: `cargo check` in `windows/src-tauri/` and `windows/hook/`.

Add a string in English first, then translate it in `windows/src/i18n/extra.json`.

## Rules of the house

- Secrets go in Windows Credential Manager / Linux Secret Service, never on disk or in git.
- No telemetry, no network calls except to services the user configured.
- Never block Claude Code: if the app doesn't answer, the hook must exit right away.
- Never write `~/.claude/settings.json` without a backup and the user's confirmation.
- Pill IDs are stable: never rename one.

## Pull requests

- One topic per PR, with a short GIF or screenshot for anything visual.
- Build must pass with no new warnings.
