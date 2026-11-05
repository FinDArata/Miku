// Everything that differs between operating systems, behind one set of names.
//
// The rest of the app calls `platform::…` and never touches Win32 or a Linux
// API directly. Each OS file exposes the same functions; the compiler picks one.

use std::path::PathBuf;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use self::windows::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use self::linux::*;
// "Open terminal" on Linux: the process tree from /proc, then KWin, EWMH, kitty.
#[cfg(target_os = "linux")]
mod linux_focus;
#[cfg(target_os = "linux")]
pub use self::linux_focus::{focus_session_window, process_ancestors, window_owners};

/// Wall-clock time in the user's time zone, for log lines and backup names.
pub struct LocalTime {
    pub year: u32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

/// The user's home directory, where `.claude/settings.json` lives.
pub fn home_dir() -> PathBuf {
    std::env::var_os(HOME_VAR)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

// ── Carrying an old install over ─────────────────────────────────────────────
//
// This app was called Kanon before it was Miku. `config_dir()` and `local_dir()`
// now point at the new folders, so without this an update would look like a
// fresh install: no settings, an empty recap history, and an inbox and log gone.
//
// The move is a **copy that never deletes the source**. The old folder is left
// exactly as it was, so an install that goes back to an older build still finds
// its files, and a failure halfway through leaves both copies usable. Every item
// is skipped once it is already in the new folder, so running it on each launch
// is cheap and converges.
//
// Only the file layout is carried over. The relay is not: it is named after the
// old binary and Miku stages its own on the next launch. The hook entries in
// Claude Code's settings.json are recognised and replaced by the installer,
// which matches the old marker too.

/// A folder's tree copied into another folder, never deleting anything.
struct Carry {
    from: PathBuf,
    to: PathBuf,
}

/// The folder names the build before the rebrand used. They stay spelled the old
/// way: they are where that build actually wrote, and nothing else can find it.
#[cfg(windows)]
const LEGACY_DIR_WINDOWS: &str = "Kanon";
#[cfg(target_os = "linux")]
const LEGACY_DIR_LINUX: &str = "kanon";

impl Carry {
    fn run(&self) {
        self.dir(&self.from, &self.to);
    }

    fn dir(&self, from: &std::path::Path, to: &std::path::Path) {
        let Ok(entries) = std::fs::read_dir(from) else { return };
        if std::fs::create_dir_all(to).is_err() {
            return;
        }
        for entry in entries.flatten() {
            let src = entry.path();
            let dst = to.join(entry.file_name());
            match entry.file_type() {
                Ok(t) if t.is_dir() => self.dir(&src, &dst),
                // A file already there is left alone: the new folder always wins.
                Ok(t) if t.is_file() && !dst.exists() && !is_legacy_relay(&entry.file_name()) => {
                    let _ = std::fs::copy(&src, &dst);
                }
                _ => {}
            }
        }
    }
}

/// `miku-hook` / `miku-hook.exe`: Miku stages its own relay, so these are not
/// carried over.
/// The relay of the build before the rebrand: Miku stages its own, so it is not
/// carried over. Spelled the old way on purpose — that is the file to skip.
fn is_legacy_relay(name: &std::ffi::OsStr) -> bool {
    let name = name.to_string_lossy();
    name == "kanon-hook" || name == "kanon-hook.exe"
}

/// Carries a Kanon install's files into Miku's folders, once per launch. Cheap
/// when there is nothing to do: a readdir that comes back empty.
pub fn migrate_legacy_dirs() {
    for (from, to) in legacy_dirs() {
        if from.is_dir() && from != to {
            Carry { from, to }.run();
        }
    }
}

/// The (old, new) folder pairs on this system: preferences and local data.
fn legacy_dirs() -> Vec<(PathBuf, PathBuf)> {
    vec![
        (legacy_dir("APPDATA", "XDG_CONFIG_HOME", ".config"), config_dir()),
        (legacy_dir("LOCALAPPDATA", "XDG_DATA_HOME", ".local/share"), local_dir()),
    ]
}

/// The folder this app used before the rebrand, computed by the same rule as the
/// current one so the two always sit side by side. The names are the old ones on
/// purpose: they are where the old build actually wrote (see LEGACY_* below).
fn legacy_dir(win_var: &str, xdg_var: &str, xdg_fallback: &str) -> PathBuf {
    #[cfg(windows)]
    {
        let _ = (xdg_var, xdg_fallback);
        std::env::var_os(win_var)
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join(LEGACY_DIR_WINDOWS)
    }
    #[cfg(target_os = "linux")]
    {
        let _ = win_var;
        // Same rule as platform::xdg: an unset or relative variable falls back
        // to the home folder, which is where the old build wrote it.
        std::env::var_os(xdg_var)
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .unwrap_or_else(|| home_dir().join(xdg_fallback))
            .join(LEGACY_DIR_LINUX)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway folder, unique per test.
    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("miku-migrate-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &std::path::Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn a_legacy_folder_is_copied_whole_and_left_in_place() {
        let dir = temp("whole");
        let (from, to) = (dir.join("old"), dir.join("new"));
        write(&from.join("settings.json"), "{}");
        write(&from.join("Flow/notes.json"), "[]");
        // The relay the old build staged, under its own name.
        write(&from.join("bin/kanon-hook.exe"), "relay");

        Carry { from: from.clone(), to: to.clone() }.run();

        assert_eq!(std::fs::read_to_string(to.join("settings.json")).unwrap(), "{}");
        assert_eq!(std::fs::read_to_string(to.join("Flow/notes.json")).unwrap(), "[]");
        // The old copy is untouched: going back to an older build still works.
        assert!(from.join("settings.json").exists());
        assert!(from.join("Flow/notes.json").exists());
        // The old relay is not carried: Miku stages its own on next launch.
        assert!(!to.join("bin/kanon-hook.exe").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn what_the_new_build_already_wrote_is_never_overwritten() {
        let dir = temp("wins");
        let (from, to) = (dir.join("old"), dir.join("new"));
        write(&from.join("settings.json"), "{\"from\":\"kanon\"}");
        write(&to.join("settings.json"), "{\"from\":\"miku\"}");

        Carry { from, to: to.clone() }.run();

        assert_eq!(std::fs::read_to_string(to.join("settings.json")).unwrap(), "{\"from\":\"miku\"}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn running_it_again_changes_nothing() {
        let dir = temp("again");
        let (from, to) = (dir.join("old"), dir.join("new"));
        write(&from.join("a/b/c.json"), "1");
        let carry = || Carry { from: from.clone(), to: to.clone() }.run();

        carry();
        carry();

        assert_eq!(std::fs::read_to_string(to.join("a/b/c.json")).unwrap(), "1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_legacy_folder_is_not_an_error() {
        let dir = temp("absent");
        Carry { from: dir.join("nope"), to: dir.join("new") }.run();
        assert!(!dir.join("new").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// How the desktop Mochi's window can be placed and clicked on this system.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DesktopMode {
    /// Windows: placed anywhere, and a cursor poll drives click-through, the
    /// eyes and the drag, exactly like the island.
    Poll,
    /// Linux on X11: an ordinary window the window manager lets us place; the
    /// input region is the click-through and the page drives the drag.
    Window,
    /// Linux on a layer-shell compositor (KDE, COSMIC, wlroots): a layer
    /// surface anchored to the top-left corner of the island's display, placed
    /// with margins.
    Layer,
    /// Wayland without layer-shell (GNOME): no way to put a window where the
    /// user dropped it, so Mochi stays in the island.
    Off,
}

impl DesktopMode {
    pub fn as_str(self) -> &'static str {
        match self {
            DesktopMode::Poll => "poll",
            DesktopMode::Window => "window",
            DesktopMode::Layer => "layer",
            DesktopMode::Off => "off",
        }
    }

    /// The space a saved spot is measured in. A spot from another space (the
    /// same machine once on X11, once on Wayland) is not trusted.
    pub fn space(self) -> &'static str {
        match self {
            // Physical pixels of the whole desktop, as the OS reports monitors.
            DesktopMode::Poll | DesktopMode::Window => "screen",
            // Logical pixels from the top-left corner of the island's display.
            DesktopMode::Layer | DesktopMode::Off => "layer",
        }
    }
}

/// Which part of the desktop Mochi's window takes the mouse.
#[derive(Clone, Copy, PartialEq, Debug)]
#[cfg_attr(windows, allow(dead_code))]
pub enum MouseShape {
    /// Nothing: every click goes to what is underneath (during a flight).
    Empty,
    /// The whole window (while he is being dragged across the screen).
    Whole,
    /// A disc, in window-logical pixels: Mochi's body.
    Disc { cx: f64, cy: f64, r: f64 },
}
