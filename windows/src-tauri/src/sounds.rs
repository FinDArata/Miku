// Your own sounds: a file named like one of Mochi's sounds in the sounds folder
// replaces it (finish.wav, approval.mp3, greet.m4a…), as on the Mac
// (SoundEngine.customFolder). The folder is platform::config_dir()/sounds:
// ~/.config/miku/sounds on Linux, %APPDATA%\Miku\sounds on Windows.
//
// The page decodes the bytes itself; a file it can't decode falls back to the
// built-in sound there (src/core/sound.ts).

use crate::platform;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

/// Formats a webview can usually decode, looked for in this order.
const EXTENSIONS: [&str; 10] = ["wav", "mp3", "ogg", "oga", "m4a", "aac", "flac", "aiff", "aif", "caf"];
/// A sound effect, not an album: anything bigger is left alone.
const MAX_BYTES: u64 = 8 * 1024 * 1024;

pub fn folder() -> PathBuf {
    platform::config_dir().join("sounds")
}

/// A sound name is a bare lowercase word ("finish"): nothing that could leave the folder.
fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 32 && name.bytes().all(|b| b.is_ascii_lowercase())
}

/// The user's file for `name` in `dir`, if there is a usable one.
fn custom_file(dir: &Path, name: &str) -> Option<PathBuf> {
    if !valid_name(name) {
        return None;
    }
    EXTENSIONS.iter().map(|ext| dir.join(format!("{name}.{ext}"))).find(|p| {
        std::fs::metadata(p).map(|m| m.is_file() && m.len() > 0 && m.len() <= MAX_BYTES).unwrap_or(false)
    })
}

/// Which of `names` have a file of the user's own.
#[tauri::command]
pub fn custom_sounds(names: Vec<String>) -> Vec<String> {
    let dir = folder();
    names.into_iter().filter(|n| custom_file(&dir, n).is_some()).collect()
}

/// The bytes of the user's file for `name`, sent as they are.
#[tauri::command]
pub fn custom_sound(name: String) -> Result<tauri::ipc::Response, String> {
    let path = custom_file(&folder(), &name).ok_or_else(|| format!("no custom sound for {name}"))?;
    std::fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

/// Settings → Open sounds folder: creates it if needed and shows it.
#[tauri::command]
pub fn reveal_sounds_folder() {
    let dir = folder();
    let _ = std::fs::create_dir_all(&dir);
    platform::reveal_folder(&dir.to_string_lossy());
}

/// Settings → Choose file…: the picked file becomes `<name>.<ext>` in the folder.
/// The bytes come as the request's raw body, the name and format as headers.
#[tauri::command]
pub fn save_custom_sound(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let header = |key: &str| {
        request.headers().get(key).and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase()
    };
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("no file".into());
    };
    save_in(&folder(), &header("name"), &header("ext"), bytes)
}

fn save_in(dir: &Path, name: &str, ext: &str, bytes: &[u8]) -> Result<(), String> {
    if !valid_name(name) || !EXTENSIONS.contains(&ext) {
        return Err(format!("not a sound Miku can use: {name}.{ext}"));
    }
    if bytes.is_empty() || bytes.len() as u64 > MAX_BYTES {
        return Err("the file is empty or bigger than 8 MB".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    // The same sound in another format would be found first: it steps aside
    // as `<name>.<ext>.old` rather than being deleted.
    for other in EXTENSIONS.iter().filter(|e| **e != ext) {
        let old = dir.join(format!("{name}.{other}"));
        if old.is_file() {
            let _ = std::fs::rename(&old, dir.join(format!("{name}.{other}.old")));
        }
    }
    std::fs::write(dir.join(format!("{name}.{ext}")), bytes).map_err(|e| e.to_string())
}

/// Settings → Reload sounds: the island reads the folder again.
#[tauri::command]
pub fn reload_sounds(app: AppHandle) {
    let _ = app.emit("sounds-changed", ());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kanon-sounds-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_file_named_like_a_sound_replaces_it_in_the_first_format_found() {
        let dir = scratch("pick");
        std::fs::write(dir.join("finish.mp3"), b"mp3").unwrap();
        std::fs::write(dir.join("finish.wav"), b"wav").unwrap();
        assert_eq!(custom_file(&dir, "finish"), Some(dir.join("finish.wav")));
        std::fs::write(dir.join("greet.m4a"), b"m4a").unwrap();
        assert_eq!(custom_file(&dir, "greet"), Some(dir.join("greet.m4a")));
        assert_eq!(custom_file(&dir, "approval"), None);
    }

    #[test]
    fn nothing_outside_the_folder_or_unusable_is_read() {
        let dir = scratch("guard");
        std::fs::write(dir.join("empty.wav"), b"").unwrap();
        std::fs::create_dir_all(dir.join("folder.wav")).unwrap();
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        assert_eq!(custom_file(&dir, "empty"), None);
        assert_eq!(custom_file(&dir, "folder"), None);
        assert_eq!(custom_file(&dir, "notes"), None);
        for bad in ["../finish", "Finish", "fin ish", "", "a/b", "finish.wav"] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn a_picked_file_becomes_the_one_found_and_the_old_one_steps_aside() {
        let dir = scratch("save");
        std::fs::write(dir.join("line.wav"), b"wav").unwrap();
        save_in(&dir, "line", "mp3", b"mp3").unwrap();
        assert_eq!(custom_file(&dir, "line"), Some(dir.join("line.mp3")));
        assert!(dir.join("line.wav.old").is_file());
        assert!(save_in(&dir, "../x", "mp3", b"x").is_err());
        assert!(save_in(&dir, "line", "exe", b"x").is_err());
        assert!(save_in(&dir, "line", "mp3", b"").is_err());
    }
}
