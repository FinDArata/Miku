// Dropped files are copied into %LOCALAPPDATA%\Miku\inbox so the original is
// never touched and the copy survives the drag source going away.
// The inbox is swept of anything older than a week, as on macOS.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::settings;

const KEEP_FOR: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFile {
    pub name: String,
    pub path: String,
    pub size: u64,
}

pub fn inbox_dir() -> PathBuf {
    settings::local_dir().join("inbox")
}

// ── Paths a real drop delivered ─────────────────────────────────────────────
//
// `ingest_file` is callable from the page, so on its own it would copy any file
// the user can read (a script injected into the page could pull in ~/.ssh).
// Only paths the OS just delivered through a real drop are accepted: WebView2's
// drop objects on Windows (webview_drop.rs), Tauri's drag-drop window event
// elsewhere (lib.rs). Each is good once, for a couple of minutes.

const DROP_VALID_FOR: Duration = Duration::from_secs(120);
const DROP_MAX_PENDING: usize = 64;

static DROPPED: std::sync::Mutex<Vec<(String, std::time::Instant)>> = std::sync::Mutex::new(Vec::new());

/// Records paths that came from a real drop.
pub fn allow_dropped<I: IntoIterator<Item = String>>(paths: I) {
    let mut list = DROPPED.lock().unwrap_or_else(|e| e.into_inner());
    let now = std::time::Instant::now();
    list.retain(|(_, at)| now.duration_since(*at) < DROP_VALID_FOR);
    for p in paths {
        list.push((p, now));
    }
    let excess = list.len().saturating_sub(DROP_MAX_PENDING);
    list.drain(..excess);
}

/// True (once) when `path` was delivered by a drop in the last couple of minutes.
fn take_dropped(path: &str) -> bool {
    let mut list = DROPPED.lock().unwrap_or_else(|e| e.into_inner());
    let now = std::time::Instant::now();
    list.retain(|(_, at)| now.duration_since(*at) < DROP_VALID_FOR);
    match list.iter().position(|(p, _)| p == path) {
        Some(i) => {
            list.remove(i);
            true
        }
        None => false,
    }
}

#[cfg(test)]
pub fn ingest(source: &str) -> Result<DroppedFile, String> {
    ingest_with(source, &mut |_, _| {})
}

/// Copies a dropped file into the inbox, telling `progress` (bytes copied, of
/// the file's size) as it goes: Miku shows the copy while she holds the file.
pub fn ingest_with(source: &str, progress: &mut dyn FnMut(u64, u64)) -> Result<DroppedFile, String> {
    if !take_dropped(source) {
        return Err(crate::i18n::t("Only files dropped on the island can be added."));
    }
    let src = Path::new(source);
    let meta = std::fs::metadata(src)
        .map_err(|e| crate::i18n::tf("Cannot read {path}: {error}", &[("path", source), ("error", &e.to_string())]))?;
    if meta.is_dir() {
        return Err(crate::i18n::t("Folders can't be dropped yet."));
    }

    let dir = inbox_dir();
    crate::platform::ensure_private_dir(&settings::local_dir()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());

    // Dragged off the shelf and dropped back on the island: it is already here.
    if src.parent().and_then(|p| p.canonicalize().ok()) == dir.canonicalize().ok() {
        return Ok(DroppedFile { name, path: source.to_string(), size: meta.len() });
    }

    let mut dest = dir.join(&name);
    if dest.exists() {
        let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let ext = src.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
        for i in 2..1000 {
            let candidate = dir.join(format!("{stem} ({i}){ext}"));
            if !candidate.exists() {
                dest = candidate;
                break;
            }
        }
    }

    // Written afresh (not CopyFileEx, which carries the source's old timestamps
    // across and would have the sweep delete it on the spot): the inbox ages
    // from when *we* copied it.
    if let Err(e) = copy_reporting(src, &dest, meta.len(), progress) {
        let _ = std::fs::remove_file(&dest);
        return Err(crate::i18n::tf("Cannot copy: {error}", &[("error", &e.to_string())]));
    }
    sweep(&dir);

    Ok(DroppedFile {
        name,
        path: dest.to_string_lossy().to_string(),
        size: meta.len(),
    })
}

/// Copies `src` to a new file `dest` a megabyte at a time, reporting each step.
fn copy_reporting(src: &Path, dest: &Path, total: u64, progress: &mut dyn FnMut(u64, u64)) -> std::io::Result<()> {
    use std::io::{Read, Write};
    let mut from = std::fs::File::open(src)?;
    let mut to = std::fs::File::options().write(true).create_new(true).open(dest)?;
    let mut buf = vec![0u8; 1 << 20];
    let mut copied = 0u64;
    loop {
        let n = from.read(&mut buf)?;
        if n == 0 {
            break;
        }
        to.write_all(&buf[..n])?;
        copied += n as u64;
        progress(copied, total);
    }
    to.flush()
}

// ── The shelf ─────────────────────────────────────────────────────────────────
//
// The shelf is the inbox itself: what Miku caught stays there for a week, and
// the island lists it, opens it, shows it in the file manager, drags it back
// out or takes it off. The page only ever names a file; it never hands a path.

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShelfFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    /// When it landed on the shelf, in ms since the epoch.
    pub added: u64,
}

/// What is on the shelf, newest first, once the week's sweep has run.
pub fn shelf_list() -> Vec<ShelfFile> {
    let dir = inbox_dir();
    sweep(&dir);
    let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };
    let mut files: Vec<ShelfFile> = entries
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let added = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64;
            Some(ShelfFile {
                name: e.file_name().to_string_lossy().to_string(),
                path: e.path().to_string_lossy().to_string(),
                size: meta.len(),
                added,
            })
        })
        .collect();
    files.sort_by(|a, b| b.added.cmp(&a.added));
    files
}

/// A plain file name: nothing that could climb out of the inbox.
fn plain_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':', '\0'])
}

/// The shelf file called `name`, or an error for anything that is not one.
pub fn shelf_path(name: &str) -> Result<PathBuf, String> {
    if !plain_name(name) {
        return Err("Not a file on the shelf.".into());
    }
    let path = inbox_dir().join(name);
    if !path.is_file() {
        return Err("Not a file on the shelf.".into());
    }
    Ok(path)
}

/// Takes one file off the shelf (the copy; the original was never touched).
pub fn shelf_remove(name: &str) -> Result<(), String> {
    std::fs::remove_file(shelf_path(name)?).map_err(|e| e.to_string())
}

/// Takes everything off the shelf.
pub fn shelf_clear() {
    for f in shelf_list() {
        let _ = std::fs::remove_file(f.path);
    }
}

/// Drops anything copied here more than a week ago. `ingest` stamps every copy
/// with the time it landed, so this really is the age of the copy and not the
/// age of whatever the user happened to drag in.
fn sweep(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(copied) = meta.modified() else { continue };
        if now.duration_since(copied).map(|age| age > KEEP_FOR).unwrap_or(false) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ingest_copies_and_never_overwrites() {
        let tmp = std::env::temp_dir().join(format!("miku-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let source = tmp.join("note.txt");
        std::fs::write(&source, b"hello").unwrap();

        let drop = |p: &Path| allow_dropped([p.to_string_lossy().to_string()]);
        drop(&source);
        let first = ingest(source.to_str().unwrap()).unwrap();
        assert_eq!(first.name, "note.txt");
        assert_eq!(std::fs::read(&first.path).unwrap(), b"hello");

        // A second drop of the same name must not clobber the first copy.
        std::fs::write(&source, b"second").unwrap();
        drop(&source);
        let second = ingest(source.to_str().unwrap()).unwrap();
        assert_ne!(first.path, second.path);
        assert_eq!(std::fs::read(&first.path).unwrap(), b"hello");
        assert_eq!(std::fs::read(&second.path).unwrap(), b"second");

        // Folders are refused rather than silently ignored.
        drop(&tmp);
        assert!(ingest(tmp.to_str().unwrap()).is_err());

        // An ancient source must not arrive already older than the sweep window.
        let old_source = tmp.join("ancient.txt");
        std::fs::write(&old_source, b"old").unwrap();
        let long_ago = SystemTime::now() - KEEP_FOR - Duration::from_secs(60 * 60);
        std::fs::File::options()
            .write(true)
            .open(&old_source)
            .unwrap()
            .set_modified(long_ago)
            .unwrap();
        drop(&old_source);
        let aged = ingest(old_source.to_str().unwrap()).unwrap();
        assert!(
            Path::new(&aged.path).exists(),
            "a file copied just now was swept as if it were a week old"
        );
        let _ = std::fs::remove_file(&aged.path);

        let _ = std::fs::remove_file(&first.path);
        let _ = std::fs::remove_file(&second.path);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

#[cfg(test)]
mod drop_tests {
    use super::*;

    // One test: the list is process-wide and tests run in parallel.
    #[test]
    fn only_a_dropped_path_is_ingested_once_and_the_list_stays_bounded() {
        let p = "/tmp/miku-test-not-dropped.txt".to_string();
        assert!(ingest(&p).is_err(), "never dropped");
        allow_dropped([p.clone()]);
        assert!(take_dropped(&p));
        assert!(!take_dropped(&p), "good once");

        allow_dropped((0..200).map(|i| format!("/tmp/bounded-{i}")));
        assert!(DROPPED.lock().unwrap().len() <= DROP_MAX_PENDING);
        assert!(take_dropped("/tmp/bounded-199"));
        assert!(!take_dropped("/tmp/bounded-0"));
    }
}

#[cfg(test)]
mod shelf_tests {
    use super::*;

    #[test]
    fn the_page_can_only_name_a_file_in_the_inbox() {
        for bad in ["", ".", "..", "../secret", "..\\secret", "C:\\Windows\\win.ini", "/etc/passwd", "a/b", "nul\0"] {
            assert!(!plain_name(bad), "{bad:?} must be refused");
            assert!(shelf_path(bad).is_err(), "{bad:?} must be refused");
        }
        assert!(plain_name("rapport-q3 (2).pdf"));
        assert!(shelf_path("surely-not-on-the-shelf-4242.pdf").is_err(), "missing files are refused too");
    }
}
