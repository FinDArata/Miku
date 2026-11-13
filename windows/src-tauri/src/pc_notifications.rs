// LINE and Discord in the island, from the notifications Windows already shows.
//
// Neither has an API for a personal account that is safe to use (an unofficial
// client risks the account), and the official notification listener needs an
// app with package identity. What every Windows user has instead is the
// Notification Center's own store, %LOCALAPPDATA%\Microsoft\Windows\
// Notifications\wpndatabase.db: each toast an app shows lands there, with its
// title and text. Miku reads it — read-only, only while the user turned this on
// (Settings → The island), only LINE's and Discord's toasts, only the ones that
// arrive after it started looking — and hands each new one to the island.
// Nothing is written anywhere; the format is Windows' own and undocumented, so
// a failure to read is quiet, never an error the user has to deal with.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// One toast, as the island reads it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PcNotification {
    /// "line" or "discord".
    pub app: String,
    /// The sender, or the server and channel.
    pub title: String,
    pub body: String,
}

/// How often the store is looked at while the setting is on.
const EVERY: Duration = Duration::from_secs(3);

/// Which app a notification handler belongs to: LINE Desktop (both packagings),
/// Discord, and the same two mirrored from a phone by Phone Link.
pub fn app_of(handler: &str) -> Option<&'static str> {
    let h = handler.to_ascii_lowercase();
    if h.contains("discord") {
        Some("discord")
    } else if h.ends_with("!line") || h.contains("jp.naver.line") {
        Some("line")
    } else {
        None
    }
}

/// The `<text>` elements of a toast's XML, in order, unescaped.
pub fn texts(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<text") {
        let after = &rest[start + 5..];
        // `<text>` or `<text id="1">`, not `<textx`.
        if !after.starts_with('>') && !after.starts_with(' ') {
            rest = after;
            continue;
        }
        let Some(open_end) = after.find('>') else { break };
        if after[..open_end].ends_with('/') {
            rest = &after[open_end + 1..];
            continue;
        }
        let body = &after[open_end + 1..];
        let Some(close) = body.find("</text>") else { break };
        out.push(unescape(&body[..close]));
        rest = &body[close + 7..];
    }
    out
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// Starts the watcher thread; it reads only while the setting is on.
pub fn start(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("miku-pc-notifications".into())
        .spawn(move || watch(&app));
    if let Err(err) = spawned {
        crate::log::line(format!("pc notifications: no thread: {err}"));
    }
}

fn enabled(app: &AppHandle) -> bool {
    app.try_state::<crate::Shared>()
        .is_some_and(|s| s.settings.lock().unwrap().pc_notifications)
}

fn watch(app: &AppHandle) {
    // The newest arrival seen; None until the first look (which only sets it,
    // so a store full of old toasts is never replayed as new).
    let mut seen: Option<i64> = None;
    loop {
        std::thread::sleep(EVERY);
        if !enabled(app) {
            seen = None;
            continue;
        }
        let Some(path) = store_path() else { continue };
        match read_since(&path, seen) {
            Ok((newest, found)) => {
                let first = seen.is_none();
                seen = Some(newest.max(seen.unwrap_or(0)));
                if first {
                    continue;
                }
                for n in found {
                    let _ = app.emit_to(crate::island::WINDOW_LABEL, "pc-notification", n);
                }
            }
            Err(err) => crate::log::line(format!("pc notifications: {err}")),
        }
    }
}

fn store_path() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    let p = std::path::Path::new(&base).join("Microsoft\\Windows\\Notifications\\wpndatabase.db");
    p.exists().then_some(p)
}

/// LINE's and Discord's toasts that arrived after `since` (all of them when it
/// is None), and the newest arrival time in the store.
fn read_since(path: &std::path::Path, since: Option<i64>) -> Result<(i64, Vec<PcNotification>), String> {
    use rusqlite::{Connection, OpenFlags};
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())?;
    let _ = conn.busy_timeout(Duration::from_millis(500));
    let newest: i64 = conn
        .query_row("SELECT IFNULL(MAX(ArrivalTime), 0) FROM Notification", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let Some(since) = since else { return Ok((newest, Vec::new())) };
    let mut stmt = conn
        .prepare(
            "SELECT h.PrimaryId, n.Payload FROM Notification n \
             JOIN NotificationHandler h ON h.RecordId = n.HandlerId \
             WHERE n.Type = 'toast' AND n.ArrivalTime > ?1 ORDER BY n.ArrivalTime",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([since], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows.flatten() {
        let (handler, payload) = row;
        let Some(app) = app_of(&handler) else { continue };
        let xml = String::from_utf8_lossy(&payload);
        let mut t = texts(&xml).into_iter().filter(|s| !s.trim().is_empty());
        let title = t.next().unwrap_or_default();
        let body = t.collect::<Vec<_>>().join(" ");
        if title.is_empty() && body.is_empty() {
            continue;
        }
        out.push(PcNotification {
            app: app.to_string(),
            title: title.chars().take(120).collect(),
            body: body.chars().take(400).collect(),
        });
    }
    Ok((newest, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handlers_are_told_apart() {
        assert_eq!(app_of("com.squirrel.Discord.Discord"), Some("discord"));
        assert_eq!(app_of("LINE_x486b4ff3yryg!LINE"), Some("line"));
        assert_eq!(app_of("NAVER.WIN32_LINEwin8_8ptj331gd3tyt!LINE"), Some("line"));
        assert_eq!(app_of("Microsoft.YourPhone_8wekyb3d8bbwe!YourPhoneNotifications_jp.naver.line.android"), Some("line"));
        assert_eq!(app_of("Microsoft.YourPhone_8wekyb3d8bbwe!YourPhoneNotifications_com.discord"), Some("discord"));
        assert_eq!(app_of("5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"), None);
        assert_eq!(app_of("Claude_pzs8sxrjxfjjc!Claude"), None);
    }

    #[test]
    fn a_toast_gives_its_texts() {
        let xml = r#"<toast><visual><binding template="ToastGeneric"><text>sora</text><text id="2">a &amp; b &lt;3</text><textx>no</textx><text/><image src="x"/></binding></visual></toast>"#;
        assert_eq!(texts(xml), vec!["sora".to_string(), "a & b <3".to_string()]);
    }
}
