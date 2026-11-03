# Changelog — Kanon

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
