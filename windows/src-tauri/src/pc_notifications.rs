// The notifications Windows already shows, in the island: LINE and Discord as
// chats, every other app's toast as a plain notice.
//
// LINE and Discord have no API for a personal account that is safe to use (an
// unofficial client risks the account), and the official notification listener
// needs an app with package identity. What every Windows user has instead is the
// Notification Center's own store, %LOCALAPPDATA%\Microsoft\Windows\
// Notifications\wpndatabase.db: each toast an app shows lands there, with its
// title and text. Miku reads it — read-only, only while the user turned this on
// (Settings → The island), only the ones that arrive after it started looking —
// and hands each new one to the island. A LINE or Discord toast whose app is
// already in front is skipped: it is being read as it arrives. WhatsApp has its
// own link (whatsapp/) and Miku's own toasts are hers, so neither comes twice.
// Nothing is written anywhere; the format is Windows' own and undocumented, so
// a failure to read is quiet, never an error the user has to deal with.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// One toast, as the island reads it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PcNotification {
    /// "line", "discord", or "pc" for any other app.
    pub app: String,
    /// The app's name to show: "LINE", "Discord", or one read off the handler.
    pub name: String,
    /// The sender, or the server and channel.
    pub title: String,
    pub body: String,
    /// Where the app itself said the toast leads (`launch="…"`), when it said
    /// anything — a chat to open instead of just the app. Discord writes none
    /// today, so this is usually empty.
    pub target: Option<String>,
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

/// Toasts the island never shows as plain notices: WhatsApp has its own link
/// (it would come twice), and Miku's own are hers.
pub fn skipped(handler: &str) -> bool {
    let h = handler.to_ascii_lowercase();
    h.contains("whatsapp") || h.contains("com.findarata.miku")
}

/// A name to show for any other app, read off its handler (an AUMID):
/// `Microsoft.Office.OUTLOOK.EXE.15` → Outlook, `MSEdge` → Edge, a packaged
/// `Vendor.App_hash!Id` → App, a phone app mirrored by Phone Link
/// (`…YourPhoneNotifications_com.instagram.android`) → Instagram, an exe path → its stem.
pub fn name_of(handler: &str) -> String {
    let h = handler.trim();
    let h = match h.rsplit_once("YourPhoneNotifications_") {
        Some((_, pkg)) => pkg,
        None => h.split_once('!').map_or(h, |(pkg, _)| pkg.split('_').next().unwrap_or(pkg)),
    };
    // An exe path: its file name.
    let h = h.rsplit(['\\', '/']).next().unwrap_or(h);
    const NOISE: &[&str] = &["exe", "app", "com", "org", "net", "android", "desktop", "microsoft", "windows", "win32"];
    let word = h
        .split('.')
        .rev()
        .find(|w| !w.is_empty() && !w.chars().all(|c| c.is_ascii_digit()) && !NOISE.contains(&w.to_ascii_lowercase().as_str()))
        .unwrap_or(h);
    match word.to_ascii_lowercase().as_str() {
        "msedge" => "Edge".into(),
        "immersivecontrolpanel" => "Settings".into(),
        "sechealthui" => "Windows Security".into(),
        // ALLCAPS or lowercase: capitalised; anything mixed is kept as written.
        _ if word.chars().all(|c| !c.is_lowercase()) || word.chars().all(|c| !c.is_uppercase()) => {
            let mut c = word.chars();
            c.next().map_or_else(String::new, |f| f.to_uppercase().chain(c.flat_map(char::to_lowercase)).collect())
        }
        _ => word.to_string(),
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

/// The `launch="…"` the toast XML may carry: where the app says a click on it
/// leads. Most toasts carry none; when one does, the island can open that
/// chat instead of the app as a whole.
pub fn launch_of(xml: &str) -> Option<String> {
    let start = xml.find("launch=\"")? + "launch=\"".len();
    let rest = &xml[start..];
    let end = rest.find('"')?;
    let said = unescape(&rest[..end]);
    let said = said.trim();
    (!said.is_empty()).then(|| said.to_string())
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

/// The chat app a program in front is, by its exe: Discord (plain, PTB,
/// Canary) and LINE's desktop app — the same two the toasts come from.
pub fn app_in_front(id: &str) -> Option<&'static str> {
    if id.contains("discord") {
        Some("discord")
    } else if id == "line" {
        Some("line")
    } else {
        None
    }
}

/// A program agents run in, by its exe or window class: the Claude app, an
/// editor, a terminal. Stepping into one is seeing the agent that finished.
pub fn agent_host_in_front(id: &str) -> bool {
    matches!(
        id,
        "claude" | "code" | "code - insiders" | "cursor" | "windsurf" | "zed" | "windowsterminal" | "wt"
            | "openconsole" | "conhost" | "cmd" | "powershell" | "pwsh" | "wezterm-gui" | "wezterm"
            | "alacritty" | "warp" | "kitty" | "ghostty" | "gnome-terminal-server" | "konsole" | "kgx"
            | "ptyxis" | "xterm" | "tilix" | "terminator" | "foot" | "xfce4-terminal"
    )
}

fn watch(app: &AppHandle) {
    // The newest arrival seen; None until the first look (which only sets it,
    // so a store full of old toasts is never replayed as new).
    let mut seen: Option<i64> = None;
    // The chat app last seen in front. Windows sends no receipt back when a
    // message is read in the app itself, so being in front is the only signal
    // there is: the step into Discord or LINE is the step that read them.
    let mut read_app: Option<&'static str> = None;
    // One read-only connection kept between ticks: opening the store every
    // three seconds paid for its WAL sidecars each time. A failed tick drops
    // it, and the next one reopens.
    let mut conn: Option<rusqlite::Connection> = None;
    loop {
        std::thread::sleep(EVERY);
        let front_id = crate::flow::os::foreground_app().map(|(id, _)| id);
        // Every look, whatever the LINE / Discord setting: an agent that
        // finishes while its app is already in front is seen there too.
        if front_id.as_deref().is_some_and(agent_host_in_front) {
            let _ = app.emit_to(crate::island::WINDOW_LABEL, "agent-seen", ());
        }
        if !enabled(app) {
            seen = None;
            read_app = None;
            continue;
        }
        let front = front_id.as_deref().and_then(app_in_front);
        if front != read_app {
            read_app = front;
            if let Some(app_name) = front {
                let _ = app.emit_to(crate::island::WINDOW_LABEL, "pc-read", app_name);
            }
        }
        let Some(path) = store_path() else {
            conn = None;
            continue;
        };
        match read_since(&mut conn, &path, seen) {
            Ok((newest, found)) => {
                let first = seen.is_none();
                seen = Some(newest.max(seen.unwrap_or(0)));
                if first {
                    continue;
                }
                for n in found {
                    // The toast's app is already in front: its messages are
                    // being read there, by the same step pc-read goes by.
                    // Showing it now would set an unread that no later step
                    // into the app can clear — the app is in front already —
                    // so the sign would hang after the message was read. The
                    // toast that was clicked, or arrived while reading, never
                    // becomes a sign.
                    if n.app != "pc" && front == Some(n.app.as_str()) {
                        continue;
                    }
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

/// The toasts that arrived after `since` (all of them when it
/// is None), and the newest arrival time in the store. The read-only
/// connection is kept between ticks; a failing one is dropped for a reopen.
fn read_since(
    conn: &mut Option<rusqlite::Connection>,
    path: &std::path::Path,
    since: Option<i64>,
) -> Result<(i64, Vec<PcNotification>), String> {
    use rusqlite::OpenFlags;
    if conn.is_none() {
        *conn = Some(
            rusqlite::Connection::open_with_flags(
                path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
            .map_err(|e| e.to_string())?,
        );
    }
    let Some(open) = conn else { unreachable!("just opened") };
    let _ = open.busy_timeout(Duration::from_millis(500));
    let outcome = read_all(open, since);
    if outcome.is_err() {
        *conn = None;
    }
    outcome
}

fn read_all(conn: &rusqlite::Connection, since: Option<i64>) -> Result<(i64, Vec<PcNotification>), String> {
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
        if skipped(&handler) {
            continue;
        }
        let (app, name) = match app_of(&handler) {
            Some("discord") => ("discord", "Discord".to_string()),
            Some(chat) => (chat, "LINE".to_string()),
            None => ("pc", name_of(&handler)),
        };
        let xml = String::from_utf8_lossy(&payload);
        let mut t = texts(&xml).into_iter().filter(|s| !s.trim().is_empty());
        let title = t.next().unwrap_or_default();
        let body = t.collect::<Vec<_>>().join(" ");
        if title.is_empty() && body.is_empty() {
            continue;
        }
        out.push(PcNotification {
            app: app.to_string(),
            name,
            title: title.chars().take(120).collect(),
            body: body.chars().take(400).collect(),
            target: launch_of(&xml),
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
    fn any_other_app_gets_a_name() {
        assert_eq!(name_of("Microsoft.Office.OUTLOOK.EXE.15"), "Outlook");
        assert_eq!(name_of("MSEdge"), "Edge");
        assert_eq!(name_of("Chrome"), "Chrome");
        assert_eq!(name_of("Microsoft.Windows.SecHealthUI_cw5n1h2txyewy!SecHealthUI"), "Windows Security");
        assert_eq!(name_of("windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel"), "Settings");
        assert_eq!(name_of("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), "SpotifyMusic");
        assert_eq!(name_of("Microsoft.YourPhone_8wekyb3d8bbwe!YourPhoneNotifications_com.instagram.android"), "Instagram");
        assert_eq!(name_of(r"{6D809377-6AF0-444B-8957-A3773F02200E}\Steam\steam.exe"), "Steam");
        assert!(skipped("5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"));
        assert!(skipped("Microsoft.YourPhone_8wekyb3d8bbwe!YourPhoneNotifications_com.whatsapp"));
        assert!(skipped("com.findarata.miku"));
        assert!(!skipped("MSEdge"));
    }

    #[test]
    fn a_toast_gives_its_texts() {
        let xml = r#"<toast><visual><binding template="ToastGeneric"><text>sora</text><text id="2">a &amp; b &lt;3</text><textx>no</textx><text/><image src="x"/></binding></visual></toast>"#;
        assert_eq!(texts(xml), vec!["sora".to_string(), "a & b <3".to_string()]);
        assert_eq!(launch_of(xml), None);
    }

    #[test]
    fn a_toast_that_says_where_it_leads_says_so() {
        let xml = r#"<toast launch="discord://-/channels/@me/123456789012345678"><visual><binding template="ToastGeneric"><text>miku</text></binding></visual></toast>"#;
        assert_eq!(launch_of(xml).as_deref(), Some("discord://-/channels/@me/123456789012345678"));
        // An empty launch is none at all.
        assert_eq!(launch_of(r#"<toast launch=""><visual/></toast>"#), None);
        assert_eq!(launch_of("<toast></toast>"), None);
    }

    #[test]
    fn agent_hosts_are_known() {
        assert!(agent_host_in_front("claude"));
        assert!(agent_host_in_front("windowsterminal"));
        assert!(agent_host_in_front("code"));
        assert!(!agent_host_in_front("discord"));
        assert!(!agent_host_in_front("chrome"));
    }

    #[test]
    fn the_apps_in_front_are_the_ones_the_toasts_come_from() {
        assert_eq!(app_in_front("discord"), Some("discord"));
        assert_eq!(app_in_front("discordptb"), Some("discord"));
        assert_eq!(app_in_front("discordcanary"), Some("discord"));
        assert_eq!(app_in_front("line"), Some("line"));
        // An exe whose name merely carries the letters is not the app.
        assert_eq!(app_in_front("streamlink"), None);
        assert_eq!(app_in_front("airliner"), None);
        assert_eq!(app_in_front("explorer"), None);
    }
}
