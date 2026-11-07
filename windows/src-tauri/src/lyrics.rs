// The floating lyrics overlay — MiniLyrics' idea on Windows and Linux: a small
// always-on-top strip that follows whatever Spotify plays and shows the line
// being sung, with the ones around it.
//
// The window is created at launch, hidden, like the Miku window and the
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

/// The window's logical size, only as a fallback: `LyricsPref` carries the
/// user's own, and is what the window is actually built with.
const WIDTH: f64 = 420.0;
const HEIGHT: f64 = 160.0;
/// Above the bottom edge, in logical px, on a first show.
const MARGIN: f64 = 72.0;

/// Where WebView2 is told to park a hidden window off-screen (the pill's trick).
const PARKED: (f64, f64) = (-32000.0, -32000.0);

/// Ceiling for a lyrics answer. A long song's LRC is a few KB.
const MAX_LYRICS: usize = 256 * 1024;

/// What a show/hide remembered.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LyricsPref {
    /// The user turned the overlay on.
    pub shown: bool,
    /// Where lyrics are drawn by default: in the island or in the floating window.
    /// A file from before this field existed reads as "island", not as "".
    #[serde(default = "default_placement", deserialize_with = "placement_field")]
    pub placement: String,
    /// Its top-left corner, in physical screen pixels, where they last put it.
    pub spot: Option<(f64, f64)>,
}

impl Default for LyricsPref {
    fn default() -> Self {
        // Lyrics are on from the first launch, drawn in the top island: a song
        // that starts shows its words without anyone opening Settings first.
        // Settings → General → Floating lyrics is where they are turned off.
        Self { shown: true, placement: "island".into(), spot: None }
    }
}

/// `placement` as the island and the overlay read it. A file written by a build
/// that had no such field (or with a value we do not know) reads as "island",
/// which is where lyrics are drawn by default.
fn placement_or_default(value: &str) -> String {
    match value.trim() {
        "floating" => "floating".into(),
        _ => "island".into(),
    }
}

fn default_placement() -> String {
    "island".into()
}

/// A settings.json's `placement`, normalised: `""` and anything unknown become
/// "island" rather than a placement neither surface draws in.
fn placement_field<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = String::deserialize(deserializer).unwrap_or_default();
    Ok(placement_or_default(&raw))
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
    let (pref, screen, size) = {
        let Some(shared) = app.try_state::<crate::Shared>() else { return };
        let s = shared.settings.lock().unwrap();
        (s.lyrics.clone(), s.screen.clone(), (s.lyrics_width, s.lyrics_height))
    };
    let mut builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, page_url(app))
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("Miku lyrics")
        .inner_size(size.0, size.1)
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
            // The remembered spot, whether or not the card is up yet: a drag
            // that only lands the window when it is first shown would lose it.
            place(app, &win, pref.spot, &screen);
            // The window only appears where the words are drawn in it: in the
            // island, the top pill follows the same Music events instead.
            if pref.shown && pref.placement == "floating" {
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
    // In the island, the floating window must not appear even when lyrics are on:
    // `lyrics.shown` is the master switch, `placement` says which surface draws.
    let in_island = app
        .try_state::<crate::Shared>()
        .is_some_and(|s| s.settings.lock().unwrap().lyrics.placement != "floating");
    let show = show && !in_island;
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

/// Hides the card because the music stopped, without touching the switch in
/// Settings: the overlay comes back on the next song. `lyrics_set_visible`
/// stays the user's own control.
#[tauri::command]
pub fn lyrics_auto_hide(app: AppHandle) {
    let (spot, screen) = {
        let Some(shared) = app.try_state::<crate::Shared>() else { return };
        let s = shared.settings.lock().unwrap();
        (s.lyrics.spot, s.screen.clone())
    };
    show_window(&app, false, spot.as_ref(), &screen);
    if let Some(win) = window(&app) {
        let _ = tauri::Emitter::emit(&win, "lyrics-shown", false);
    }
}

/// Puts the card back on screen for a song starting, likewise without touching
/// the switch.
#[tauri::command]
pub fn lyrics_auto_show(app: AppHandle) {
    let (spot, screen) = {
        let Some(shared) = app.try_state::<crate::Shared>() else { return };
        let s = shared.settings.lock().unwrap();
        (s.lyrics.spot, s.screen.clone())
    };
    crate::settings::declare_music_pill(&app);
    show_window(&app, true, spot.as_ref(), &screen);
    if let Some(win) = window(&app) {
        let _ = tauri::Emitter::emit(&win, "lyrics-shown", true);
    }
}

/// The card's look, changed from its own right-click menu. Only these fields
/// are written: the overlay knows nothing of the rest of Settings, and sending
/// a whole `Settings` back from it would reset everything else.
#[tauri::command]
pub fn lyrics_set_look(
    app: AppHandle,
    opacity: Option<f64>,
    font_size: Option<f64>,
    text_color: Option<String>,
    background: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
) {
    let (changed, snapshot) = {
        let Some(shared) = app.try_state::<crate::Shared>() else { return };
        let mut s = shared.settings.lock().unwrap();
        let clamp = |v: f64, lo: f64, hi: f64| if v.is_finite() { v.clamp(lo, hi) } else { lo };
        let mut changed = false;
        if let Some(v) = opacity {
            s.lyrics_opacity = clamp(v, 0.0, 1.0);
            changed = true;
        }
        if let Some(v) = font_size {
            s.lyrics_font_size = clamp(v, 10.0, 40.0);
            changed = true;
        }
        if let Some(v) = text_color.filter(|c| is_hex_color(c)) {
            s.lyrics_text_color = v;
            changed = true;
        }
        if let Some(v) = background.filter(|c| is_hex_color(c)) {
            s.lyrics_background = v;
            changed = true;
        }
        if let Some(v) = width {
            s.lyrics_width = clamp(v, 200.0, 900.0);
            changed = true;
        }
        if let Some(v) = height {
            s.lyrics_height = clamp(v, 90.0, 400.0);
            changed = true;
        }
        if !changed {
            return;
        }
        (true, s.clone())
    };
    if changed {
        crate::settings::save_soon(&app);
        // Every window hears the change, the overlay included: it repaints.
        let _ = tauri::Emitter::emit(&app, "settings-changed", &snapshot);
    }
}

/// `#RRGGBB`, the only shape a colour reaches the page as.
fn is_hex_color(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(u8::is_ascii_hexdigit)
}

/// Grows or shrinks the window for a moment — the right-click menu needs more
/// room than the card — without touching the card's saved size.
#[tauri::command]
pub fn lyrics_window_size(app: AppHandle, width: f64, height: f64) {
    let Some(win) = window(&app) else { return };
    let w = if width.is_finite() { width.clamp(200.0, 900.0) } else { 420.0 };
    let h = if height.is_finite() { height.clamp(90.0, 600.0) } else { 170.0 };
    let app2 = app.clone();
    let w2 = win.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = w2.set_size(tauri::LogicalSize::new(w, h));
        // Keep the top-left corner where it is: the menu is anchored in it.
        if let Ok(pos) = w2.outer_position() {
            let _ = w2.set_position(tauri::PhysicalPosition::new(pos.x, pos.y));
        }
        let _ = &app2;
    });
}

/// Changes where lyrics are drawn while preserving visibility and floating spot.
#[tauri::command]
pub fn lyrics_set_placement(app: AppHandle, placement: String) {
    let placement = if placement == "floating" { "floating" } else { "island" };
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let (snapshot, spot, screen) = {
        let mut s = shared.settings.lock().unwrap();
        if s.lyrics.placement == placement { return; }
        s.lyrics.placement = placement.to_string();
        (s.clone(), s.lyrics.spot, s.screen.clone())
    };
    crate::settings::save_soon(&app);
    // The floating window follows at once: shown for "floating", parked for "island".
    show_window(&app, snapshot.lyrics.shown, spot.as_ref(), &screen);
    let _ = tauri::Emitter::emit(&app, "settings-changed", &snapshot);
}

/// Settings' switch, and what the overlay reports for itself.
#[tauri::command]
pub fn lyrics_set_visible(app: AppHandle, visible: bool) {
    // The overlay is dumb: it draws whatever the `spotify` events carry, and
    // those only come while the Music pill is declared. Turning the lyrics on
    // therefore declares it too, or the overlay would be a blank strip.
    if visible {
        crate::settings::declare_music_pill(&app);
    }
    // Showing puts it back where the user left it; hiding keeps that spot.
    let (spot, screen, snapshot) = {
        let Some(shared) = app.try_state::<crate::Shared>() else { return };
        let mut s = shared.settings.lock().unwrap();
        s.lyrics.shown = visible;
        let spot = s.lyrics.spot;
        let screen = s.screen.clone();
        let snapshot = s.clone();
        drop(s);
        crate::settings::save_soon(&app);
        (spot, screen, snapshot)
    };
    // The island draws the words when lyrics live in the pill: it needs the switch.
    let _ = tauri::Emitter::emit(&app, "settings-changed", &snapshot);
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
    pub placement: String,
    /// Whether ordinary browser videos may open the card (Settings → General).
    pub videos: bool,
    /// The card's dressing: see `LyricsPref`.
    pub opacity: f64,
    pub font_size: f64,
    pub text_color: String,
    pub background: String,
}

impl LyricsPrefsView {
    fn of(romanize: bool, show_original: bool, s: &crate::settings::Settings) -> Self {
        Self {
            romanize,
            show_original,
            placement: s.lyrics.placement.clone(),
            videos: s.lyrics_videos,
            opacity: s.lyrics_opacity,
            font_size: s.lyrics_font_size,
            text_color: s.lyrics_text_color.clone(),
            background: s.lyrics_background.clone(),
        }
    }
}

/// The page's copy of the preferences, so a window that has just opened does
/// not have to wait for the next settings change to draw right.
#[tauri::command]
pub fn lyrics_prefs(app: AppHandle) -> LyricsPrefsView {
    app.try_state::<crate::Shared>()
        .map(|shared| {
            let s = shared.settings.lock().unwrap();
            LyricsPrefsView::of(s.lyrics_romanize, s.lyrics_show_original, &s)
        })
        .unwrap_or_else(|| {
            let d = crate::settings::Settings::default();
            LyricsPrefsView::of(true, true, &d)
        })
}

/// Applies a new size to the overlay's window, keeping its top-left corner.
#[tauri::command]
pub fn lyrics_resize(app: AppHandle, width: f64, height: f64) {
    let clamp = |v: f64, lo: f64, hi: f64, fallback: f64| if v.is_finite() { v.clamp(lo, hi) } else { fallback };
    let (w, h) = (clamp(width, 200.0, 900.0, 420.0), clamp(height, 90.0, 400.0, 160.0));
    let (spot, screen) = {
        let Some(shared) = app.try_state::<crate::Shared>() else { return };
        let mut s = shared.settings.lock().unwrap();
        if (s.lyrics_width - w).abs() < f64::EPSILON && (s.lyrics_height - h).abs() < f64::EPSILON {
            return;
        }
        s.lyrics_width = w;
        s.lyrics_height = h;
        let out = (s.lyrics.spot, s.screen.clone());
        drop(s);
        out
    };
    crate::settings::save_soon(&app);
    let Some(win) = window(&app) else { return };
    let app2 = app.clone();
    let w2 = win.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = w2.set_size(tauri::LogicalSize::new(w, h));
        // Keep it where the user put it rather than letting it drift.
        place(&app2, &w2, spot, &screen);
    });
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
    {
        let mut s = shared.settings.lock().unwrap();
        change(&mut s.lyrics);
    }
    crate::settings::save_soon(app);
}

// ── The words ─────────────────────────────────────────────────────────────────

/// The lyrics of a track, asked of LRCLIB. `None` when it has none: the
/// overlay then says so quietly instead of showing the previous song's words.
/// `busy: true` means the service could not answer at all: the page must not
/// remember that as "this song has no words", or a busy minute would hide the
/// song's lyrics for a week.
#[derive(Serialize, Clone, Debug, Default)]
pub struct LyricsAnswer {
    #[serde(flatten)]
    pub lyrics: Lyrics,
    pub busy: bool,
}

#[tauri::command]
pub async fn lyrics_fetch(artist: String, title: String, album: String, duration: f64) -> Option<LyricsAnswer> {
    let artist = artist.trim().to_string();
    let title = title.trim().to_string();
    if title.is_empty() {
        return None;
    }
    let album = album.trim().to_string();
    // A browser reports the video's title as it is: "(Official Music Video)",
    // "[Lyrics]", "【MV】". LRCLIB has the song's name only, so the tags are
    // stripped before anything is asked.
    let clean = clean_query(&title).unwrap_or_else(|| title.clone());

    // 1. An exact match, when the track's details line up.
    let mut busy = false;
    match get_exact(&artist, &clean, &album, duration).await {
        Answer::Found(json) => {
            let lyrics = from_record(&json, true);
            if !lyrics.is_empty() {
                return Some(LyricsAnswer { lyrics, busy: false });
            }
        }
        Answer::Busy => busy = true,
        Answer::None => {}
    }

    // 2. and 3. A search, twice: with the artist, then without it — a browser
    // often reports the channel's name ("VEVO", "… - Topic") as the artist,
    // which finds nothing.
    let mut queries: Vec<String> = Vec::new();
    if !artist.is_empty() {
        queries.push(format!("{artist} {clean}"));
    }
    if !queries.iter().any(|q| q == &clean) {
        queries.push(clean.clone());
    }
    for query in &queries {
        let Some(records) = search(query).await else {
            busy = true;
            continue;
        };
        if let Some(lyrics) = best_record(&records, duration, &artist, &clean) {
            return Some(LyricsAnswer { lyrics, busy: false });
        }
    }
    Some(LyricsAnswer { lyrics: Lyrics::default(), busy })
}

/// `/get`: one record, when artist and title (and album or length) all line up.
async fn get_exact(artist: &str, title: &str, album: &str, duration: f64) -> Answer {
    let Ok(mut url) = Url::parse(&format!("{LRCLIB}/get")) else { return Answer::None };
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("artist_name", artist);
        q.append_pair("track_name", title);
        if !album.is_empty() {
            q.append_pair("album_name", album);
        }
        if duration > 0.0 {
            q.append_pair("duration", &format!("{}", duration.round() as i64));
        }
    }
    get_json(url).await
}

/// `/search`: every record LRCLIB has for the words. `None` when it could not
/// answer at all, which the caller must not read as "no such song".
async fn search(query: &str) -> Option<Vec<serde_json::Value>> {
    let mut url = Url::parse(&format!("{LRCLIB}/search")).ok()?;
    url.query_pairs_mut().append_pair("q", query);
    match get_json(url).await {
        Answer::Found(json) => Some(json.as_array().cloned().unwrap_or_default()),
        Answer::None => Some(Vec::new()),
        Answer::Busy => None,
    }
}

/// The best of a search's records, not the first: LRCLIB returns covers and
/// karaoke takes first more often than it should, and a record whose length is
/// the track's own is the one that was playing.
fn best_record(records: &[serde_json::Value], duration: f64, artist: &str, title: &str) -> Option<Lyrics> {
    let mut best: Option<(i64, Lyrics)> = None;
    for record in records {
        // An instrumental has no words, so it is never the answer.
        if record.get("instrumental").and_then(serde_json::Value::as_bool) == Some(true) {
            continue;
        }
        let lyrics = from_record(record, false);
        if lyrics.is_empty() {
            continue;
        }
        let length = record.get("duration").and_then(serde_json::Value::as_f64);
        let named = record.get("trackName").and_then(serde_json::Value::as_str).is_some_and(|t| same(t, title));
        let credited = record.get("artistName").and_then(serde_json::Value::as_str).is_none_or(|a| artist_matches(a, artist));
        let points = score(&lyrics, length, duration, named && credited);
        // Strictly better, so a tie keeps the one LRCLIB ranked first.
        if best.as_ref().is_none_or(|(top, _)| points > *top) {
            best = Some((points, lyrics));
        }
    }
    best.map(|(_, lyrics)| lyrics)
}

/// Two names are the same song's when they match ignoring case and the spacing
/// around punctuation: "Get Lucky" and "get lucky" are, "Get Lucky" and
/// "Get Lucky (Remix)" are not.
fn same(a: &str, b: &str) -> bool {
    fn normal(s: &str) -> String {
        s.chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect()
    }
    normal(a) == normal(b)
}

/// Does a record's credit line name the artist that is playing? Both sides are
/// a list — a record says "Calvin Harris, Dua Lipa", the player may say
/// "Calvin Harris" — so the lists are compared, not the strings: the first
/// artist of each must be the same person. That is what a track's own credit is
/// keyed on, and it is why a duet still earns the exact-match bonus.
fn artist_matches(record_artist: &str, playing_artist: &str) -> bool {
    if playing_artist.trim().is_empty() {
        return true;
    }
    match (split_artists(record_artist).first(), split_artists(playing_artist).first()) {
        (Some(a), Some(b)) => same(a, b),
        _ => false,
    }
}

/// A credit line as a list of names: "A, B & C", "A feat. B", "A ft. B" all
/// give the artist and their guests. A name like "Simon & Garfunkel" is not
/// split — a duo is one artist, and no separator inside a name is safe to cut
/// on. Only the guests are, and those are introduced by a word.
fn split_artists(credit: &str) -> Vec<String> {
    let mut parts: Vec<String> = vec![credit.trim().to_string()];
    // "feat." and "ft." introduce a guest wherever they appear; a comma before
    // them belongs to the separator, not the name.
    for marker in [" feat. ", " ft. ", " featuring "] {
        let lowered = parts[0].to_lowercase();
        if let Some(at) = lowered.find(marker) {
            if lowered.len() == parts[0].len() && parts[0].is_char_boundary(at) {
                let rest = parts[0][at + marker.len()..].trim().to_string();
                parts[0] = parts[0][..at].trim().trim_end_matches(',').trim().to_string();
                if !rest.is_empty() {
                    parts.push(rest);
                }
            }
        }
    }
    // A comma *between whole names* is a collaboration listing. Colons, "&" and
    // "x" are not: they sit inside names ("Simon & Garfunkel", "Charli xcx").
    let mut names = Vec::new();
    for part in parts {
        for piece in part.split(',') {
            let piece = piece.trim();
            if !piece.is_empty() {
                names.push(piece.to_string());
            }
        }
    }
    names
}

/// How well a record matches the track that played. Timed words beat plain
/// ones — the card follows a moment in the song — and a record whose length is
/// the track's own beats one that is a different version of it.
fn score(lyrics: &Lyrics, length: Option<f64>, duration: f64, exact: bool) -> i64 {
    let mut points = 0;
    // The record names the song and the singer as the track does: the strongest
    // signal there is, and worth more than every other one together.
    if exact {
        points += 100;
    }
    if lyrics.synced.as_deref().is_some_and(|s| !s.trim().is_empty()) {
        points += 25;
    }
    if lyrics.plain.as_deref().is_some_and(|s| !s.trim().is_empty()) {
        points += 10;
    }
    if let (Some(length), true) = (length, duration > 0.0) {
        // Three seconds is a different reading of the same recording; a whole
        // minute is another master, a live take, a cover.
        if (length - duration).abs() <= 3.0 {
            points += 50;
        }
    }
    points
}

/// "Song (Official Music Video) [Lyrics] 【MV】" → "Song". A bracket about the
/// release — a video, a lyric sheet, a live take — is dropped; a song whose own
/// name is in parentheses stays. The Mac's `short_title` already ran upstream,
/// so this is the long tail of what browsers and YouTube put in a title.
fn clean_query(raw: &str) -> Option<String> {
    /// Words that say the bracket is about the release, not the song.
    const TAGS: [&str; 22] = [
        "official", "mv", "m/v", "video", "lyric", "lyrics", "lirik", "hd", "4k", "8k", "color coded",
        "han", "rom", "eng", "sub", "español", "live", "performance", "dance", "teaser", "shorts", "audio",
    ];

    let mut current = raw.trim().to_string();
    // Inside out, so "((Official Video))" and "Song (Live) (Official)" both go.
    while let Some(group) = last_bracket(&current) {
        let inner = current[group.inner.0..group.inner.1].to_lowercase();
        let rest = format!("{}{}", &current[..group.start], &current[group.end..]);
        let rest = tidy(&rest);
        // A tag is dropped; anything else, and the title is as it was from here.
        if !rest.is_empty() && TAGS.iter().any(|tag| mentions(&inner, tag)) {
            current = rest;
            continue;
        }
        break;
    }
    let cleaned = tidy(&current);
    if cleaned.is_empty() || cleaned == tidy(raw) {
        None
    } else {
        Some(cleaned)
    }
}

/// The words with single spaces: dropping a bracket leaves the space on either
/// side of it behind.
fn tidy(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Whether a bracket's text names `tag`: a single word matches a whole word
/// ("mv" in "MV", not in "…mvp"), a tag with a space or a slash as it stands
/// ("color coded").
fn mentions(inner: &str, tag: &str) -> bool {
    if tag.chars().any(|c| !c.is_alphanumeric()) {
        return inner.contains(tag);
    }
    inner
        .split(|c: char| !c.is_alphanumeric())
        .any(|word| word == tag)
}

/// A bracketed group: where it starts and ends in the title, brackets
/// included, and the range of its contents. `(`…`)`, `[`…`]` and `【`…`】`
/// each close only on their own character, and the brackets are not one byte.
struct Group {
    start: usize,
    end: usize,
    inner: (usize, usize),
}

/// The last bracketed group in `s` whose brackets are its own: an unbalanced
/// "(" is not a group, and an empty "()" says nothing.
fn last_bracket(s: &str) -> Option<Group> {
    const PAIRS: [(char, char); 3] = [('(', ')'), ('[', ']'), ('【', '】')];
    let mut best: Option<Group> = None;
    for (open, close) in PAIRS {
        let open_len = open.len_utf8();
        let close_len = close.len_utf8();
        // Walk the opens of this shape, keeping the last one that closes.
        let mut from = 0;
        let mut found: Option<Group> = None;
        while let Some(open_rel) = s[from..].find(open) {
            let open_at = from + open_rel;
            let Some(close_rel) = s[open_at + open_len..].find(close) else { break };
            let close_at = open_at + open_len + close_rel;
            if close_at > open_at + open_len {
                found = Some(Group {
                    start: open_at,
                    end: close_at + close_len,
                    inner: (open_at + open_len, close_at),
                });
            }
            // Another open may sit inside this group: keep walking, the inner
            // one closes first and is the better group to look at.
            from = open_at + open_len;
        }
        if let Some(group) = found {
            if best.as_ref().is_none_or(|b| group.end > b.end) {
                best = Some(group);
            }
        }
    }
    best
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
/// What a call to LRCLIB came back with: a body, "no such song", or "could not
/// answer" (busy, offline, refused). The last one must never be remembered as
/// a missing song.
enum Answer {
    Found(serde_json::Value),
    None,
    Busy,
}

async fn get_json(url: Url) -> Answer {
    if !allowed(&url) {
        crate::log::line(format!("lyrics: refused {url}"));
        return Answer::None;
    }
    let Ok(client) = crate::net::client(&url, Duration::from_secs(8)) else { return Answer::Busy };
    // LRCLIB answers 503 "server busy" under load and 429 when it wants us to
    // slow down: both are "ask again", not "no such song".
    for attempt in 0..3u32 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(400 * u64::from(attempt))).await;
        }
        let response = match client
            .get(url.clone())
            .header("accept", "application/json")
            // LRCLIB asks that a client say who it is.
            .header("user-agent", concat!("Miku/", env!("CARGO_PKG_VERSION"), " (+https://github.com/findarata/kanon)"))
            .send()
            .await
        {
            Ok(r) => r,
            Err(err) => {
                // No words is not an error the user needs: the overlay says it has none.
                crate::log::line(format!("lyrics: {} unreachable: {err}", crate::net::host_for_log(&url)));
                return Answer::Busy;
            }
        };
        let status = response.status();
        if status.is_success() {
            let Ok(bytes) = crate::net::read_capped(response, MAX_LYRICS).await else { return Answer::Busy };
            return match serde_json::from_slice(&bytes) {
                Ok(v) => Answer::Found(v),
                Err(_) => Answer::Busy,
            };
        }
        // 404 is LRCLIB's "no such track", which is an ordinary answer.
        if status != reqwest::StatusCode::SERVICE_UNAVAILABLE && status != reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Answer::None;
        }
        crate::log::line(format!("lyrics: {} busy ({status}), try {}", crate::net::host_for_log(&url), attempt + 1));
    }
    Answer::Busy
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
    fn a_clean_query_strips_only_video_and_lirc_tags() {
        // The long tail of YouTube's own title: "Song (Official Music Video) [Lyrics]"
        assert_eq!(
            clean_query("Get Lucky - Radio Edit (Official Music Video) [Lyrics]"),
            Some("Get Lucky - Radio Edit".to_string())
        );
        // "Live" and "performance" are tags too: LRCLIB's record is the song's,
        // and a live take's own title would find nothing.
        assert_eq!(
            clean_query("Bohemian Rhapsody (Live at Wembley)"),
            Some("Bohemian Rhapsody".to_string())
        );
        // A bracket with no tag in it is the song's own: nothing is stripped,
        // which is what `None` says (the caller asks with the title as it is).
        assert_eq!(clean_query("Breathe Me [the song]"), None);
        assert_eq!(clean_query("Firework (Remastered)"), None);
        assert_eq!(clean_query("Song"), None);
        // A bracket that is only a tag strips down to the song's name.
        assert_eq!(
            clean_query("Prelude No. 7 in A major (Audio)"),
            Some("Prelude No. 7 in A major".to_string())
        );
        // Nothing left to ask about is no query at all.
        assert_eq!(clean_query("(Official MV)"), None);
        assert_eq!(clean_query("[Lyrics]"), None);
        assert_eq!(clean_query("【Video】"), None);
        // A space-separated phrase matches inside a bracketed group.
        assert_eq!(clean_query("Song (Color Coded Lyrics)"), Some("Song".to_string()));
        // A slash-separated tag also matches, and the song's own name survives.
        assert_eq!(
            clean_query("Video (M/V) — Take Me Home Country Roads"),
            Some("Video — Take Me Home Country Roads".to_string())
        );
        // Several tags in a row all go, innermost first.
        assert_eq!(clean_query("Song (Official Video) (HD) [4K]"), Some("Song".to_string()));
    }

    #[test]
    fn score_keeps_the_best_record_by_exact_then_synced_then_duration() {
        let synced = |s: &str| Some(s.to_string());
        let plain = |s: &str| Some(s.to_string());
        let empty = Lyrics::default();
        // Synced beats plain when duration is the same.
        assert!(score(&Lyrics { synced: synced("[00:12]hi"), plain: None, exact: false }, None, 0.0, false) > score(&empty, None, 0.0, false));
        assert!(score(&Lyrics { synced: synced("[00:12]hi"), plain: plain("hi"), exact: false }, None, 0.0, false) > score(&Lyrics { synced: None, plain: plain("hi"), exact: false }, None, 0.0, false));
        // A record whose length is the track's own beats one far from it.
        assert!(score(&Lyrics { synced: None, plain: plain("hi"), exact: false }, Some(60.0), 58.0, false) > score(&Lyrics { synced: None, plain: plain("hi"), exact: false }, Some(45.0), 58.0, false));
        // Three seconds or less is good, four seconds is not.
        assert!(score(&Lyrics { synced: None, plain: plain("hi"), exact: false }, Some(63.0), 60.0, false) > 0);
        assert_eq!(score(&Lyrics { synced: None, plain: plain("hi"), exact: false }, Some(64.0), 60.0, false), 10);
        // Plain-only is never zero: a cover with only plain words still helps.
        assert_eq!(score(&Lyrics { synced: None, plain: plain("hi"), exact: false }, None, 0.0, false), 10);
        // The track's own name and singer outweigh everything else together: a
        // plain, wrongly-timed record that names the song still wins.
        let named = Lyrics { synced: None, plain: plain("hi"), exact: false };
        assert!(score(&named, None, 0.0, true) > score(&Lyrics { synced: synced("[00:12]hi"), plain: plain("hi"), exact: false }, Some(60.0), 60.0, false));
        assert_eq!(score(&empty, None, 0.0, true), 100);
    }

    #[test]
    fn two_names_are_the_same_song_ignoring_case_and_punctuation() {
        assert!(same("Get Lucky", "get lucky"));
        assert!(same("Don't Stop Me Now", "Dont Stop Me Now"));
        assert!(same("  Song  ", "song"));
        // A different version is a different name, and so a weaker match.
        assert!(!same("Get Lucky", "Get Lucky (Remix)"));
        assert!(!same("Song", "Another Song"));
    }

    #[test]
    fn a_credit_line_is_a_list_of_people_and_a_duo_is_one_of_them() {
        // The first name is what the lists are compared on.
        assert_eq!(split_artists("Calvin Harris, Dua Lipa"), ["Calvin Harris", "Dua Lipa"]);
        assert_eq!(split_artists("A feat. B"), ["A", "B"]);
        assert_eq!(split_artists("A ft. B"), ["A", "B"]);
        assert_eq!(split_artists("A featuring B"), ["A", "B"]);
        assert_eq!(split_artists("A, B feat. C"), ["A", "B", "C"]);
        // A duo is one artist: cutting at "&" would file half their catalogue
        // under a solo act that does not exist.
        assert_eq!(split_artists("Simon & Garfunkel"), ["Simon & Garfunkel"]);
        assert_eq!(split_artists("Florence + the Machine"), ["Florence + the Machine"]);
        assert_eq!(split_artists("Charli xcx"), ["Charli xcx"]);
        // Bodies and whitespace do not make empty names.
        assert_eq!(split_artists("  "), Vec::<String>::new());
        assert_eq!(split_artists("A,,B"), ["A", "B"]);
    }

    #[test]
    fn a_duet_earns_the_exact_match_even_when_the_player_names_one_singer() {
        // The player says "Calvin Harris", the record says both: same song.
        assert!(artist_matches("Calvin Harris, Dua Lipa", "Calvin Harris"));
        assert!(artist_matches("Calvin Harris", "Calvin Harris, Dua Lipa"));
        // The same singer with a guest is still the same singer.
        assert!(artist_matches("A feat. B", "A"));
        // A different first artist is a cover, and gets no bonus.
        assert!(!artist_matches("Some Cover Band", "Calvin Harris"));
        assert!(!artist_matches("Calvin Harris, Dua Lipa", "Dua Lipa"));
        // An empty artist on our side says nothing, so nothing is refused.
        assert!(artist_matches("Anyone", ""));
        assert!(artist_matches("Anyone", "   "));
    }

    #[test]
    fn a_colour_reaches_the_page_only_as_six_hex_digits() {
        assert!(is_hex_color("#ffffff"));
        assert!(is_hex_color("#1DB954"));
        assert!(is_hex_color("#000000"));
        for bad in [
            "ffffff", "#fff", "#fffffff", "#gggggg", "", "red", "rgb(1,2,3)", "#fff; background:url(x)",
        ] {
            assert!(!is_hex_color(bad), "accepted {bad:?}");
        }
    }

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
