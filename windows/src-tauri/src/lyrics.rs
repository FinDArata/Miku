// The floating lyrics overlay — MiniLyrics' idea on Windows and Linux: a small
// always-on-top strip that follows whatever Spotify plays and shows the line
// being sung, with the ones around it.
//
// The window is created at launch, hidden, like the Kanon window and the
// dictation pill: a WebView2 window built after the island comes up blank in
// this app (see create_settings_window in lib.rs). `lyrics_set_visible` only
// shows and hides it, and remembers the choice.
//
// The window itself is dumb: it listens to the same `spotify` events the island
// does, runs the clock on from `positionAt` and draws. Only the lyrics text
// comes from here, because the page cannot reach the network (the app's CSP is
// `connect-src 'self' ipc:`), and because a request the app makes must be
// checked: https only, and never to this machine or a private network.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use reqwest::Url;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The window's label, and what the island's player events are mirrored to.
pub const WINDOW_LABEL: &str = "lyrics";

/// The service the words come from: LRCLIB, which needs no key and no account.
const LRCLIB: &str = "https://lrclib.net/api";

/// The window's logical size: three lines of a song's worth of text.
const WIDTH: f64 = 560.0;
const HEIGHT: f64 = 220.0;
/// Above the bottom edge, in logical px, on a first show.
const MARGIN: f64 = 72.0;

/// Where WebView2 is told to park a hidden window off-screen (the pill's trick).
const PARKED: (f64, f64) = (-32000.0, -32000.0);

/// Ceiling for a lyrics answer. A long song's LRC is a few KB.
const MAX_LYRICS: usize = 256 * 1024;

/// What a show/hide remembered.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LyricsPref {
    /// The user turned the overlay on.
    pub shown: bool,
    /// Its top-left corner, in physical screen pixels, where they last put it.
    pub spot: Option<(f64, f64)>,
}

/// One track's words, as LRCLIB has them. Both may be there; `synced` is
/// preferred and `plain` is the fallback.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    /// The LRC text, timestamps and all.
    pub synced: Option<String>,
    /// The words with no timing.
    pub plain: Option<String>,
    /// LRCLIB matched this track exactly; false for a search's best guess.
    pub exact: bool,
}

impl Lyrics {
    fn is_empty(&self) -> bool {
        self.synced.as_deref().is_none_or(str::is_empty) && self.plain.as_deref().is_none_or(str::is_empty)
    }
}

fn page_url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/lyrics.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("lyrics.html".into())
}

/// Creates the overlay's window, hidden. Before the island, for WebView2's
/// sake (see create_settings_window in lib.rs). The preference decides whether
/// it is shown at launch.
pub fn setup(app: &AppHandle) {
    let (pref, screen) = {
        let Some(shared) = app.try_state::<crate::Shared>() else { return };
        let s = shared.settings.lock().unwrap();
        (s.lyrics.clone(), s.screen.clone())
    };
    let mut builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, page_url(app))
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("Kanon lyrics")
        .inner_size(WIDTH, HEIGHT)
        // GTK will not go below its natural size on a non-resizable window
        // (island::apply_geometry has the same note).
        .resizable(cfg!(target_os = "linux"))
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        // The page drags the window itself (core:drag-region): nothing to drop.
        .disable_drag_drop_handler()
        .visible(false);
    // Windows parks it like the pill: a hidden WebView2 window it can place
    // again is simpler than one that is never placed at all.
    if cfg!(windows) {
        builder = builder.position(PARKED.0, PARKED.1);
    }
    match builder.build() {
        Ok(win) => {
            place(app, &win, pref.spot, &screen);
            if pref.shown {
                show_window(app, true, pref.spot.as_ref(), &screen);
            }
            // Dragging it (the page's own drag region) is a window move: that
            // is where the spot comes from, on both systems.
            let moved = app.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::Moved(pos) = event {
                    on_moved(&moved, pos.x, pos.y);
                }
            });
            spawn_spot_saver(app.clone());
        }
        Err(err) => crate::log::line(format!("lyrics window failed: {err}")),
    }
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

/// Puts the window at the remembered spot, or at the bottom centre of the
/// display the island lives on. A saved spot no longer on any display (it was
/// unplugged) falls back the same way.
fn place(app: &AppHandle, win: &WebviewWindow, spot: Option<(f64, f64)>, screen: &str) {
    let Some((x, y)) = spot.filter(|&(x, y)| on_some_display(app, win, x, y)).or_else(|| default_spot(app, win, screen)) else {
        return;
    };
    let _ = win.set_position(tauri::PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

fn on_some_display(app: &AppHandle, win: &WebviewWindow, x: f64, y: f64) -> bool {
    let Ok(size) = win.outer_size() else { return false };
    let Ok(monitors) = app.available_monitors() else { return false };
    // A sliver of the window on a display is enough: the user put it there.
    monitors.iter().any(|m| {
        let p = m.position();
        let s = m.size();
        let right = x + size.width as f64;
        let bottom = y + size.height as f64;
        right > p.x as f64 && x < (p.x + s.width as i32) as f64 && bottom > p.y as f64 && y < (p.y + s.height as i32) as f64
    })
}

fn default_spot(app: &AppHandle, win: &WebviewWindow, screen: &str) -> Option<(f64, f64)> {
    let monitor = crate::island::target_monitor(app, screen)?;
    let scale = monitor.scale_factor();
    let p = monitor.position();
    let s = monitor.size();
    let w = win.outer_size().ok().map(|s| s.width as f64).unwrap_or(WIDTH * scale);
    let h = win.outer_size().ok().map(|s| s.height as f64).unwrap_or(HEIGHT * scale);
    let x = p.x as f64 + (s.width as f64 - w) / 2.0;
    let y = p.y as f64 + s.height as f64 - h - MARGIN * scale;
    Some((x.max(p.x as f64), y.max(p.y as f64)))
}

fn show_window(app: &AppHandle, show: bool, spot: Option<&(f64, f64)>, screen: &str) {
    let Some(win) = window(app) else { return };
    let w = win.clone();
    let app2 = app.clone();
    let spot = spot.copied();
    let screen = screen.to_string();
    let moved = move || {
        if show {
            if let Some(spot) = spot {
                place(&app2, &w, Some(spot), &screen);
            }
            let _ = w.show();
            let _ = w.set_always_on_top(true);
        } else if cfg!(windows) {
            let _ = w.set_position(tauri::PhysicalPosition::new(PARKED.0, PARKED.1));
        } else {
            let _ = w.hide();
        }
    };
    // On Linux the window has to be realized on the main thread.
    if app.run_on_main_thread(moved).is_err() {
        let _ = win.is_visible();
    }
}

/// Settings' switch, and what the overlay reports for itself.
#[tauri::command]
pub fn lyrics_set_visible(app: AppHandle, visible: bool) {
    // Showing puts it back where the user left it; hiding keeps that spot.
    let (spot, screen) = {
        let Some(shared) = app.try_state::<crate::Shared>() else { return };
        let mut s = shared.settings.lock().unwrap();
        s.lyrics.shown = visible;
        let spot = s.lyrics.spot;
        let screen = s.screen.clone();
        let snapshot = s.clone();
        drop(s);
        if let Err(err) = crate::settings::save(&snapshot) {
            crate::log::line(format!("could not save settings: {err}"));
        }
        (spot, screen)
    };
    show_window(&app, visible, spot.as_ref(), &screen);
    // The page tells it whether to draw: a hidden window must cost nothing.
    if let Some(win) = window(&app) {
        let _ = tauri::Emitter::emit(&win, "lyrics-visible", visible);
    }
}

/// The overlay's preferences as its page reads them, for its first frame.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyricsPrefsView {
    pub romanize: bool,
    pub show_original: bool,
}

impl LyricsPrefsView {
    fn of(romanize: bool, show_original: bool) -> Self {
        Self { romanize, show_original }
    }
}

/// The page's copy of the two preferences, so a window that has just opened
/// does not have to wait for the next settings change to draw right.
#[tauri::command]
pub fn lyrics_prefs(app: AppHandle) -> LyricsPrefsView {
    let (romanize, show_original) = app
        .try_state::<crate::Shared>()
        .map(|s| {
            let s = s.settings.lock().unwrap();
            (s.lyrics_romanize, s.lyrics_show_original)
        })
        .unwrap_or((true, true));
    LyricsPrefsView::of(romanize, show_original)
}

/// Whether the overlay is on, for the page's first frame.
#[tauri::command]
pub fn lyrics_visible(app: AppHandle) -> bool {
    app.try_state::<crate::Shared>()
        .is_some_and(|s| s.settings.lock().unwrap().lyrics.shown)
}

/// Bumped by every move, so the saver thread can tell a drag is over.
static MOVED: AtomicU64 = AtomicU64::new(0);

/// Where the user left it. A `Moved` event comes for every pixel of a drag and
/// each save is the whole settings file, so the spot is kept in memory at once
/// and written 600 ms after the window stops moving, by one thread.
fn on_moved(app: &AppHandle, x: i32, y: i32) {
    // Parking a hidden window is a move too, and so is the first placement:
    // only where the user left a window they can see is worth keeping.
    if (x as f64, y as f64) == PARKED {
        return;
    }
    if !window(app).and_then(|w| w.is_visible().ok()).unwrap_or(false) {
        return;
    }
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    {
        let mut s = shared.settings.lock().unwrap();
        if s.lyrics.spot == Some((x as f64, y as f64)) {
            return;
        }
        s.lyrics.spot = Some((x as f64, y as f64));
    }
    MOVED.fetch_add(1, Ordering::SeqCst);
}

/// Started with the window: writes the spot once the drag settles.
fn spawn_spot_saver(app: AppHandle) {
    std::thread::Builder::new()
        .name("kanon-lyrics-spot".into())
        .spawn(move || {
            let mut written = 0;
            loop {
                std::thread::sleep(Duration::from_millis(300));
                let seen = MOVED.load(Ordering::SeqCst);
                if seen == written {
                    continue;
                }
                // Two looks in a row without a move: the drag is over.
                std::thread::sleep(Duration::from_millis(300));
                if MOVED.load(Ordering::SeqCst) != seen {
                    continue;
                }
                written = seen;
                remember(&app, |_| {});
            }
        })
        .ok();
}

fn remember(app: &AppHandle, change: impl FnOnce(&mut LyricsPref)) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let snapshot = {
        let mut s = shared.settings.lock().unwrap();
        change(&mut s.lyrics);
        s.clone()
    };
    if let Err(err) = crate::settings::save(&snapshot) {
        crate::log::line(format!("could not save settings: {err}"));
    }
}

// ── The words ─────────────────────────────────────────────────────────────────

/// The lyrics of a track, asked of LRCLIB. `None` when it has none: the
/// overlay then says so quietly instead of showing the previous song's words.
#[tauri::command]
pub async fn lyrics_fetch(artist: String, title: String, album: String, duration: f64) -> Option<Lyrics> {
    let artist = artist.trim().to_string();
    let title = title.trim().to_string();
    if title.is_empty() {
        return None;
    }
    let album = album.trim().to_string();

    // An exact match when the track's details line up, else a search.
    let mut url = Url::parse(&format!("{LRCLIB}/get")).ok()?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("artist_name", &artist);
        q.append_pair("track_name", &title);
        if !album.is_empty() {
            q.append_pair("album_name", &album);
        }
        if duration > 0.0 {
            q.append_pair("duration", &format!("{}", duration.round() as i64));
        }
    }
    if let Some(json) = get_json(url).await {
        let lyrics = from_record(&json, true);
        if !lyrics.is_empty() {
            return Some(lyrics);
        }
    }

    // Album and duration rarely match a re-release or a live take: search the
    // title and artist, and take the first result that has words.
    let mut url = Url::parse(&format!("{LRCLIB}/search")).ok()?;
    url.query_pairs_mut().append_pair("q", &format!("{artist} {title}"));
    let json = get_json(url).await?;
    for record in json.as_array().into_iter().flatten() {
        let lyrics = from_record(record, false);
        if !lyrics.is_empty() {
            return Some(lyrics);
        }
    }
    None
}

/// One LRCLIB record → what the overlay draws.
fn from_record(record: &serde_json::Value, exact: bool) -> Lyrics {
    let text = |key: &str| {
        record
            .get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    Lyrics { synced: text("syncedLyrics"), plain: text("plainLyrics"), exact }
}

/// A JSON answer from LRCLIB. Only https, and only a public host: the address
/// is fixed here, but the check is what keeps a future edit from pointing it
/// at this machine or a private network.
async fn get_json(url: Url) -> Option<serde_json::Value> {
    if !allowed(&url) {
        crate::log::line(format!("lyrics: refused {url}"));
        return None;
    }
    let client = crate::net::client(&url, Duration::from_secs(8)).ok()?;
    let response = match client
        .get(url.clone())
        .header("accept", "application/json")
        // LRCLIB asks that a client say who it is.
        .header("user-agent", concat!("Kanon/", env!("CARGO_PKG_VERSION"), " (+https://github.com/findarata/kanon)"))
        .send()
        .await
    {
        Ok(r) => r,
        Err(err) => {
            // No words is not an error the user needs: the overlay says it has none.
            crate::log::line(format!("lyrics: {} unreachable: {err}", crate::net::host_for_log(&url)));
            return None;
        }
    };
    // 404 is LRCLIB's "no such track", which is an ordinary answer.
    if !response.status().is_success() {
        return None;
    }
    let bytes = crate::net::read_capped(response, MAX_LYRICS).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// https only, and never this machine or a private network. The host is
/// resolved and every address refused unless it is public, which also stops a
/// public name pointing at 192.168.x.x.
fn allowed(url: &Url) -> bool {
    if url.scheme() != "https" || url.host_str().is_none_or(str::is_empty) {
        return false;
    }
    if crate::net::is_loopback_url(url) {
        return false;
    }
    public_host(url)
}

fn public_host(url: &Url) -> bool {
    use std::net::ToSocketAddrs;
    let Some(host) = url.host_str() else { return false };
    let Some(port) = url.port_or_known_default() else { return false };
    let Ok(addrs) = (host, port).to_socket_addrs() else { return false };
    let mut any = false;
    for addr in addrs {
        if !is_public(addr.ip()) {
            return false;
        }
        any = true;
    }
    any
}

/// A globally routable address: not loopback, private, link-local, shared
/// (CGNAT), documentation, benchmark, multicast or otherwise reserved.
fn is_public(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_multicast()
                || v4.is_unspecified()
                // 100.64.0.0/10, carrier-grade NAT
                || (o[0] == 100 && (64..128).contains(&o[1]))
                // 192.0.0.0/24 and 198.18.0.0/15, IETF and benchmarking
                || (o[0] == 192 && o[1] == 0 && o[2] == 0)
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
                // 240.0.0.0/4, reserved
                || o[0] >= 240)
        }
        IpAddr::V6(v6) => {
            let seg = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // fc00::/7, unique local
                || (seg[0] & 0xfe00) == 0xfc00
                // fe80::/10, link-local
                || (seg[0] & 0xffc0) == 0xfe80
                // 2001:db8::/32, documentation
                || (seg[0] == 0x2001 && seg[1] == 0x0db8)
                || v6.to_ipv4_mapped().is_some_and(|v4| !is_public(std::net::IpAddr::V4(v4))))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_to_a_public_host_is_asked() {
        assert!(allowed(&Url::parse("https://lrclib.net/api/get").unwrap()));
        for bad in [
            "http://lrclib.net/api/get",
            "ftp://lrclib.net/api/get",
            "https://localhost/api/get",
            "https://127.0.0.1/api/get",
            "https://[::1]/api/get",
            "https://0.0.0.0/api/get",
            "https://192.168.1.10/api/get",
            "https://10.1.2.3/api/get",
            "https://169.254.1.1/api/get",
            "https://[fd00::1]/api/get",
            "https://[fe80::1]/api/get",
            "https://100.64.0.1/api/get",
            "https://example.com@127.0.0.1/api/get",
        ] {
            assert!(!allowed(&Url::parse(bad).unwrap()), "{bad} must be refused");
        }
    }

    #[test]
    fn reserved_ranges_are_not_public() {
        for ip in ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.0.1", "0.0.0.0", "100.64.0.1", "198.18.0.1", "240.0.0.1", "224.0.0.1"] {
            let ip: std::net::IpAddr = ip.parse().unwrap();
            assert!(!is_public(ip), "{ip} must not be public");
        }
        for ip in ["1.1.1.1", "20.190.151.6", "2606:4700:4700::1111"] {
            let ip: std::net::IpAddr = ip.parse().unwrap();
            assert!(is_public(ip), "{ip} must be public");
        }
    }

    #[test]
    fn a_record_gives_its_synced_and_plain_words() {
        let both = serde_json::json!({ "syncedLyrics": "[00:01.00]hi", "plainLyrics": "hi" });
        let l = from_record(&both, true);
        assert_eq!(l.synced.as_deref(), Some("[00:01.00]hi"));
        assert_eq!(l.plain.as_deref(), Some("hi"));
        assert!(l.exact);
        assert!(!l.is_empty());

        let blank = serde_json::json!({ "syncedLyrics": "  ", "plainLyrics": null });
        assert!(from_record(&blank, false).is_empty());
        assert!(!from_record(&blank, false).exact);
    }
}
