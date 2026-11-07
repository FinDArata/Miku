// Small append-only log at %LOCALAPPDATA%\Miku\miku.log (Windows) or
// ~/.local/share/miku/miku.log (Linux) — the equivalent of nbLog() in
// HookServer.swift. Nothing leaves the machine.

use std::io::Write;
use std::sync::{Mutex, MutexGuard, PoisonError};

use crate::{platform, settings};

/// Past this, the file is rotated to miku.log.1 rather than deleted: a long
/// run keeps its history, and only the oldest file is dropped.
const MAX_BYTES: u64 = 1_000_000;

/// The open file and how much has been written to it. Opening it once per
/// line cost three syscalls for every log line the app writes.
struct Held {
    file: std::fs::File,
    size: u64,
}

static LOG: Mutex<Option<Held>> = Mutex::new(None);

fn held() -> MutexGuard<'static, Option<Held>> {
    LOG.lock().unwrap_or_else(PoisonError::into_inner)
}

fn open(path: &std::path::Path) -> Option<Held> {
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    // Readable by us only, like the macOS log.
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let file = options.open(path).ok()?;
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    Some(Held { file, size })
}

pub fn line(message: impl AsRef<str>) {
    let t = platform::local_time();
    let stamp = format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        t.year, t.month, t.day, t.hour, t.minute, t.second
    );
    let dir = settings::local_dir();
    if platform::ensure_private_dir(&dir).is_err() {
        return;
    }
    let path = dir.join("miku.log");
    let mut slot = held();
    if slot.is_none() {
        *slot = open(&path);
    }
    if slot.as_ref().is_some_and(|h| h.size > MAX_BYTES) {
        // Close it first: Windows will not rename an open file.
        *slot = None;
        let _ = std::fs::remove_file(dir.join("miku.log.1"));
        let _ = std::fs::rename(&path, dir.join("miku.log.1"));
        *slot = open(&path);
    }
    let Some(held) = slot.as_mut() else { return };
    let text = message.as_ref();
    // The stamp and the line go out in one call, so a failure leaves nothing
    // half-written and the size stays what the file holds.
    let written = writeln!(held.file, "{stamp} {text}");
    if written.is_err() {
        // The handle is no good any more (a full disk, a file taken away):
        // the next line opens it again.
        *slot = None;
        return;
    }
    held.size += stamp.len() as u64 + text.len() as u64 + 2;
}
