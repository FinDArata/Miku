// Relay server for miku-hook.
//
// Windows: the named pipe `\\.\pipe\miku-<sid>`, one instance per connection.
// Linux: the Unix socket `$XDG_RUNTIME_DIR/kanon.sock`. Every hook event is
// forwarded to the island as a `hook` event. `PermissionRequest` is the only one
// that keeps its connection open: it waits for the island's decision and writes
// it back on the same connection, which is how approving from the island works.
//
// Claude Code is never blocked by us. Three things guarantee it:
//   * miku-hook gives the connection 300 ms and exits cleanly if we are closed;
//   * we only wait for a human once the island has *confirmed* the card is on
//     screen, so a paused island or a webview that is not listening costs a few
//     hundred milliseconds, not two minutes;
//   * whatever happens we drop the connection after the decision timeout, and
//     the terminal takes over.
//
// What we write back is the bare word `allow` or `deny` — or, when the request
// was Claude Code asking a question, `{"answers":{…}}` with what was picked on
// the island. Turning either into the documented hookSpecificOutput JSON is
// miku-hook's job, so the wire format Claude Code expects lives in exactly
// one place.

use std::collections::HashMap;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
#[cfg(windows)]
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use tokio::sync::mpsc;

use crate::island::WINDOW_LABEL;
use crate::log;
use crate::session_window;

/// Slightly under miku-hook's own 110 s wait, so we always answer first.
const DECISION_TIMEOUT: Duration = Duration::from_secs(108);
/// How long the island gets to say "the card is up". This is the whole of B4:
/// without it, an island that is paused, hidden behind a crashed webview or
/// simply not listening would leave Claude Code staring at a prompt nobody can
/// see for nearly two minutes.
const ACK_TIMEOUT: Duration = Duration::from_millis(800);
const MAX_PAYLOAD: usize = 1 << 20;

/// What the island can say about a permission request.
pub enum Reply {
    /// The card is on screen and a human can act on it.
    Ack,
    /// A human clicked: `allow` or `deny`.
    Decision(String),
    /// Nobody can act on it — paused, or another request already holds the card.
    Decline,
}

/// Permission requests the island has been told about.
#[derive(Default)]
pub struct Pending(pub Mutex<HashMap<String, mpsc::Sender<Reply>>>);

impl Pending {
    /// A request starts waiting for its human.
    pub fn insert(&self, id: &str, tx: mpsc::Sender<Reply>) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id.to_string(), tx);
    }

    /// The request leaves — its answer came, or nobody waits any more.
    pub fn take(&self, id: &str) -> Option<mpsc::Sender<Reply>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).remove(id)
    }

    /// Looked at without removing: an ack keeps the request waiting.
    pub fn get(&self, id: &str) -> Option<mpsc::Sender<Reply>> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(id)
            .cloned()
    }
}

static COUNTER: AtomicU64 = AtomicU64::new(1);

/// `\\.\pipe\miku-<sid>` — must match miku-hook's `pipe_path()` exactly.
#[cfg(windows)]
pub fn pipe_name() -> String {
    match crate::platform::current_user_sid() {
        Some(key) => format!(r"\\.\pipe\miku-{key}"),
        None => {
            // The SID read failed, so the name falls back to the user name —
            // which two accounts with failing SID reads would share. Say so.
            let who = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
            log::line(format!("pipe: no user SID — the relay name falls back to miku-{who}"));
            format!(r"\\.\pipe\miku-{who}")
        }
    }
}

#[cfg(windows)]
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let name = pipe_name();
        let mut server = match open_instance(&name, true) {
            Ok(s) => s,
            Err(err) => {
                log::line(format!("cannot open the relay pipe: {err}"));
                return;
            }
        };
        loop {
            if server.connect().await.is_err() {
                // A failed instance never connects again (#853): listen on a fresh one.
                if let Ok(fresh) = open_instance(&name, false) {
                    server = fresh;
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
                continue;
            }
            // Hand the connected instance to a task and listen on a fresh one.
            let next = match open_instance(&name, false) {
                Ok(s) => s,
                Err(err) => {
                    log::line(format!("cannot reopen the relay pipe: {err}"));
                    return;
                }
            };
            let connected = std::mem::replace(&mut server, next);
            // The step Linux does with peer_cred: only our own user's relay may
            // drive the island. Refusal costs the agent nothing — it leaves
            // within its own deadline and Claude Code asks in the terminal.
            if crate::platform::pipe_client_is_same_user(connected.as_raw_handle()) {
                let app = app.clone();
                tauri::async_runtime::spawn(async move { handle(app, connected).await });
            } else {
                log::line("refused a relay connection from another user");
                let mut refused = connected;
                refused.finish();
            }
        }
    });
}

/// One pipe server instance. `first` also refuses to sit on a pipe somebody
/// else already owns under our name. The instance's DACL is the creating
/// token's default — SYSTEM, Administrators, this user, no one else — and
/// every client is asked again on connect (pipe_client_is_same_user): an
/// explicit DACL of our own would grant exactly the same three, and tokio's
/// server handle carries no WRITE_DAC to set one with, so the default it is.
#[cfg(windows)]
fn open_instance(name: &str, first: bool) -> Result<NamedPipeServer, String> {
    let mut options = ServerOptions::new();
    options.first_pipe_instance(first);
    options.create(name).map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
pub fn start(app: AppHandle) {
    use std::os::unix::fs::PermissionsExt;
    use tokio::net::UnixListener;

    tauri::async_runtime::spawn(async move {
        let Some(path) = crate::platform::relay_socket_path() else {
            log::line("no private runtime directory ($XDG_RUNTIME_DIR) — Claude Code hooks are inactive");
            return;
        };
        // A socket file left behind by a crash answers nothing and can go. One
        // that answers belongs to a Miku that is still running: like
        // first_pipe_instance on Windows, we refuse to serve on top of it.
        if path.exists() {
            if std::os::unix::net::UnixStream::connect(&path).is_ok() {
                log::line("another Miku already serves the relay socket");
                return;
            }
            let _ = std::fs::remove_file(&path);
        }
        let listener = match UnixListener::bind(&path) {
            Ok(l) => l,
            Err(err) => {
                log::line(format!("cannot open the relay socket: {err}"));
                return;
            }
        };
        // The runtime directory is already 0700; this is belt and braces.
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        let uid = unsafe { libc::getuid() };
        loop {
            let stream = match listener.accept().await {
                Ok((stream, _)) => stream,
                Err(_) => {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    continue;
                }
            };
            // Only the relay run by our own user may drive the island.
            if !matches!(stream.peer_cred(), Ok(c) if c.uid() == uid) {
                log::line("refused a relay connection from another user");
                continue;
            }
            let app = app.clone();
            tauri::async_runtime::spawn(async move { handle(app, stream).await });
        }
    });
}

/// One accepted relay connection, whatever carries it.
trait Relay: AsyncRead + AsyncWrite + Unpin {
    /// Ends the conversation once everything has been written.
    fn finish(&mut self) {}
    /// The relay process on the other end, where the OS says.
    fn client_pid(&self) -> Option<u32> {
        None
    }
}

#[cfg(windows)]
impl Relay for NamedPipeServer {
    fn finish(&mut self) {
        let _ = self.disconnect();
    }
    fn client_pid(&self) -> Option<u32> {
        use std::os::windows::io::AsRawHandle;
        crate::platform::pipe_client_pid(self.as_raw_handle())
    }
}

/// Dropping the stream closes it; the relay reads up to our newline first.
#[cfg(target_os = "linux")]
impl Relay for tokio::net::UnixStream {
    /// SO_PEERCRED: the process that connected, as the kernel saw it.
    fn client_pid(&self) -> Option<u32> {
        let pid = self.peer_cred().ok()?.pid()?;
        u32::try_from(pid).ok().filter(|pid| *pid > 1)
    }
}

/// One payload from the relay: everything it sent, or up to the first
/// newline — never more than MAX_PAYLOAD. None: the connection broke mid-read.
async fn read_payload(pipe: &mut impl Relay) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    // Where the search for the newline stopped last time: a payload of up to
    // MAX_PAYLOAD arrives in many chunks, and rescanning from byte 0 made the
    // read quadratic.
    let mut scanned = 0usize;
    loop {
        match pipe.read(&mut chunk).await {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf[scanned..].contains(&b'\n') || buf.len() > MAX_PAYLOAD {
                    break;
                }
                scanned = buf.len();
            }
            Err(_) => return None,
        }
    }
    Some(buf)
}

async fn handle(app: AppHandle, mut pipe: impl Relay) {
    let Some(buf) = read_payload(&mut pipe).await else { return };
    let line = match buf.iter().position(|b| *b == b'\n') {
        Some(i) => &buf[..i],
        None => &buf[..],
    };
    let Ok(mut payload) = serde_json::from_slice::<Value>(line) else { return };
    if !payload.is_object() {
        return;
    }

    let event = payload
        .get("hook_event_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    note_session_window(&pipe, &payload, &event);
    // Counts for the weekly recap — never the command, path or prompt itself.
    // Off this worker: the save inside is a whole-file write with an fsync,
    // and it stays inside the store lock, so the writes keep their order.
    {
        let app = app.clone();
        let payload = payload.clone();
        tauri::async_runtime::spawn_blocking(move || crate::recap::observe(&app, &payload));
    }
    // The hub window's character stage follows the same events; it cannot hear
    // them itself, so the tracker watches them here.
    crate::stage::observe(&event, payload.get("session_id").and_then(Value::as_str).unwrap_or(""));

    if event != "PermissionRequest" {
        // The status line relay calls in with every Claude Code update: not log-worthy.
        if event != "StatusLine" {
            log::line(format!("hook {event}"));
        }
        crate::stage::refresh(&app);
        let _ = app.emit_to(WINDOW_LABEL, "hook", payload);
        pipe.finish();
        return;
    }

    let id = format!("{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed));
    let (tx, mut rx) = mpsc::channel::<Reply>(4);
    app.state::<Pending>().insert(&id, tx);
    crate::stage::refresh(&app);
    crate::recap::note_request(&app, &id, &payload);
    payload["request_id"] = json!(id);
    log::line(format!("hook PermissionRequest id={id}"));
    let _ = app.emit_to(WINDOW_LABEL, "hook", payload);

    let decision = wait_for_decision(&id, &mut rx).await;
    app.state::<Pending>().take(&id);
    crate::stage::refresh(&app);

    // No decision: say nothing at all. miku-hook then writes nothing to stdout
    // and Claude Code asks in the terminal, exactly as if Miku were closed.
    // The island is told, so a card that came up late (or is still up after the
    // long wait) goes instead of holding the view with nobody to answer (#857).
    match decision {
        Some(d) => {
            let _ = pipe.write_all(format!("{d}\n").as_bytes()).await;
            let _ = pipe.flush().await;
        }
        None => {
            let _ = app.emit_to(WINDOW_LABEL, "approval-expired", &id);
        }
    }
    pipe.finish();
}

/// Finds, once per session, the window it runs in — see session_window.rs.
///
/// Only while the session is unknown, so the process snapshot is not taken on
/// every event. The relay must still be running for its parents to be found:
/// a permission request always is (it waits for us), a quick event may already
/// have exited, and then a later event of the session tries again.
fn note_session_window(pipe: &impl Relay, payload: &Value, event: &str) {
    let Some(session) = payload.get("session_id").and_then(Value::as_str) else { return };
    if event == "SessionEnd" {
        session_window::forget(session);
        return;
    }
    if session_window::known(session) {
        return;
    }
    let Some(relay) = pipe.client_pid() else { return };
    let ancestors = crate::platform::process_ancestors(relay);
    // No ancestors: the relay was already gone, so try again next time. Some,
    // but none with a window (a classic console): settled, VS Code it is.
    if !ancestors.is_empty() {
        session_window::remember(session, crate::platform::window_owners(&ancestors));
    }
}

/// Two waits: a short one for "the card is up", then the long one for a human.
async fn wait_for_decision(id: &str, rx: &mut mpsc::Receiver<Reply>) -> Option<String> {
    match tokio::time::timeout(ACK_TIMEOUT, rx.recv()).await {
        Ok(Some(Reply::Ack)) => {}
        // A click that beats the ack is still a click.
        Ok(Some(Reply::Decision(d))) => {
            log::line(format!("hook id={id} answered {}", loggable(&d)));
            return Some(d);
        }
        Ok(Some(Reply::Decline)) => {
            log::line(format!("hook id={id} not shown — terminal takes over"));
            return None;
        }
        Ok(None) => return None,
        Err(_) => {
            log::line(format!("hook id={id} island never acknowledged — terminal takes over"));
            return None;
        }
    }

    match tokio::time::timeout(DECISION_TIMEOUT, rx.recv()).await {
        Ok(Some(Reply::Decision(d))) => {
            log::line(format!("hook id={id} answered {}", loggable(&d)));
            Some(d)
        }
        Ok(Some(Reply::Decline)) => {
            log::line(format!("hook id={id} released without a decision"));
            None
        }
        _ => {
            log::line(format!("hook id={id} timed out — terminal takes over"));
            None
        }
    }
}

/// The log says a question was answered, never with what.
fn loggable(decision: &str) -> &str {
    if decision.starts_with('{') { "a question" } else { decision }
}

fn send(app: &AppHandle, request_id: &str, reply: Reply, keep: bool) {
    let pending = app.state::<Pending>();
    let sender = if keep { pending.get(request_id) } else { pending.take(request_id) };
    match sender {
        Some(tx) => {
            let _ = tx.try_send(reply);
            // A taken-out request no longer waits: the stage may leave "waiting".
            if !keep {
                crate::stage::refresh(app);
            }
        }
        None => log::line(format!("reply for id={request_id} — no pending request")),
    }
}

/// The island has the card on screen; the long wait may begin.
pub fn acknowledge(app: &AppHandle, request_id: &str) {
    send(app, request_id, Reply::Ack, true);
}

/// Nobody can act on this one — paused, or another card already holds the view.
pub fn decline(app: &AppHandle, request_id: &str) {
    log::line(format!("decline id={request_id}"));
    send(app, request_id, Reply::Decline, false);
}

/// Called by the island's Allow / Deny buttons. Only ever a bare word: turning
/// it into Claude Code's JSON is miku-hook's job.
pub fn answer(app: &AppHandle, request_id: &str, decision: &str) {
    let word = match decision {
        "allow" | "always" => "allow",
        _ => "deny",
    };
    log::line(format!("decision id={request_id} {word}"));
    send(app, request_id, Reply::Decision(word.to_string()), false);
}

/// Called when an option is picked for a question Claude Code asked. `answers`
/// maps each question's text to the chosen label, which is the shape
/// AskUserQuestion takes them in.
pub fn answer_question(app: &AppHandle, request_id: &str, answers: &HashMap<String, serde_json::Value>) {
    log::line(format!("decision id={request_id} answered a question"));
    // One line: the relay reads up to the first newline.
    let line = json!({ "answers": answers }).to_string();
    send(app, request_id, Reply::Decision(line), false);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::pin::Pin;
    use std::task::{Context, Poll};

    // ── The decision wait ─────────────────────────────────────────────────────

    #[tokio::test(start_paused = true)]
    async fn the_ack_then_the_decision_answers() {
        let (tx, mut rx) = mpsc::channel(4);
        tx.send(Reply::Ack).await.unwrap();
        tx.send(Reply::Decision("allow".into())).await.unwrap();
        assert_eq!(wait_for_decision("t", &mut rx).await.as_deref(), Some("allow"));
    }

    #[tokio::test(start_paused = true)]
    async fn a_decision_that_beats_the_ack_still_answers() {
        let (tx, mut rx) = mpsc::channel(4);
        tx.send(Reply::Decision("deny".into())).await.unwrap();
        assert_eq!(wait_for_decision("t", &mut rx).await.as_deref(), Some("deny"));
    }

    #[tokio::test(start_paused = true)]
    async fn a_decline_answers_nothing() {
        let (tx, mut rx) = mpsc::channel(4);
        tx.send(Reply::Decline).await.unwrap();
        assert_eq!(wait_for_decision("t", &mut rx).await, None);
    }

    #[tokio::test(start_paused = true)]
    async fn nobody_left_waits_for_nothing() {
        let (tx, mut rx) = mpsc::channel(4);
        tx.send(Reply::Ack).await.unwrap();
        // The island is gone: no decision will ever come.
        drop(tx);
        assert_eq!(wait_for_decision("t", &mut rx).await, None);
    }

    #[tokio::test(start_paused = true)]
    async fn an_ack_without_a_decision_times_out() {
        let (tx, mut rx) = mpsc::channel(4);
        tx.send(Reply::Ack).await.unwrap();
        // The clock is paused, so the 108 s deadline elapses the moment
        // nothing else is scheduled.
        assert_eq!(wait_for_decision("t", &mut rx).await, None);
    }

    #[tokio::test(start_paused = true)]
    async fn nothing_at_all_times_out_at_once() {
        let (_tx, mut rx) = mpsc::channel::<Reply>(4);
        assert_eq!(wait_for_decision("t", &mut rx).await, None);
    }

    #[test]
    fn the_log_says_what_happened_never_what_was_said() {
        assert_eq!(loggable("allow"), "allow");
        assert_eq!(loggable("{\"answers\":{\"q\":\"a\"}}"), "a question");
    }

    // ── The pending map ───────────────────────────────────────────────────────

    #[test]
    fn the_pending_map_answers_by_id() {
        let pending = Pending::default();
        let (tx, mut rx) = mpsc::channel(4);
        pending.insert("a", tx.clone());
        let (tx2, mut rx2) = mpsc::channel(4);
        pending.insert("b", tx2);

        // An ack keeps the request: get, not take.
        pending.get("a").unwrap().try_send(Reply::Ack).unwrap();
        assert!(matches!(rx.try_recv(), Ok(Reply::Ack)));
        assert!(pending.get("a").is_some());

        // take removes; the second take finds nothing.
        assert!(pending.take("a").is_some());
        assert!(pending.take("a").is_none());
        assert!(pending.get("a").is_none());
        assert!(pending.get("b").is_some());
        // An id nobody registered answers to nobody.
        assert!(pending.get("x").is_none());
        assert!(pending.take("x").is_none());
        let _ = rx2;
    }

    // ── Reading one payload ───────────────────────────────────────────────────

    /// A relay serving fixed bytes, `chunk` at a time, then ending.
    struct Bytes {
        data: Vec<u8>,
        at: usize,
        chunk: usize,
    }

    impl Bytes {
        fn at_once(data: &[u8]) -> Self {
            Self { data: data.to_vec(), at: 0, chunk: usize::MAX }
        }
        fn byte_at_a_time(data: &[u8]) -> Self {
            Self { data: data.to_vec(), at: 0, chunk: 1 }
        }
        fn owning(data: Vec<u8>) -> Self {
            Self { data, at: 0, chunk: usize::MAX }
        }
    }

    impl AsyncRead for Bytes {
        fn poll_read(mut self: Pin<&mut Self>, _cx: &mut Context<'_>, out: &mut tokio::io::ReadBuf<'_>) -> Poll<std::io::Result<()>> {
            let take = self.chunk.min(self.data.len() - self.at).min(out.remaining());
            let end = self.at + take;
            out.put_slice(&self.data[self.at..end]);
            self.at = end;
            Poll::Ready(Ok(()))
        }
    }

    impl AsyncWrite for Bytes {
        fn poll_write(self: Pin<&mut Self>, _cx: &mut Context<'_>, _buf: &[u8]) -> Poll<std::io::Result<usize>> {
            Poll::Ready(Err(std::io::Error::other("nowhere to write")))
        }
        fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
            Poll::Ready(Ok(()))
        }
        fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
            Poll::Ready(Ok(()))
        }
    }

    impl Relay for Bytes {}

    /// A relay whose reads always fail.
    struct Broken;

    impl AsyncRead for Broken {
        fn poll_read(self: Pin<&mut Self>, _cx: &mut Context<'_>, _out: &mut tokio::io::ReadBuf<'_>) -> Poll<std::io::Result<()>> {
            Poll::Ready(Err(std::io::Error::other("broken")))
        }
    }

    impl AsyncWrite for Broken {
        fn poll_write(self: Pin<&mut Self>, _cx: &mut Context<'_>, _buf: &[u8]) -> Poll<std::io::Result<usize>> {
            Poll::Ready(Err(std::io::Error::other("broken")))
        }
        fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
            Poll::Ready(Err(std::io::Error::other("broken")))
        }
        fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
            Poll::Ready(Err(std::io::Error::other("broken")))
        }
    }

    impl Relay for Broken {}

    #[tokio::test]
    async fn one_read_carrying_the_newline_is_one_payload() {
        let mut r = Bytes::at_once(b"{\"hook_event_name\":\"Stop\"}\nnothing after matters");
        assert_eq!(read_payload(&mut r).await.unwrap(), b"{\"hook_event_name\":\"Stop\"}\nnothing after matters");
    }

    #[tokio::test]
    async fn a_payload_in_pieces_still_adds_up() {
        let mut r = Bytes::byte_at_a_time(b"{\"a\":1}\n");
        assert_eq!(read_payload(&mut r).await.unwrap(), b"{\"a\":1}\n");
    }

    #[tokio::test]
    async fn the_stream_ending_without_a_newline_still_gives_what_came() {
        let mut r = Bytes::at_once(b"{\"a\":1}");
        assert_eq!(read_payload(&mut r).await.unwrap(), b"{\"a\":1}");
    }

    #[tokio::test]
    async fn an_empty_stream_gives_an_empty_payload() {
        let mut r = Bytes::at_once(b"");
        assert_eq!(read_payload(&mut r).await.unwrap(), b"");
    }

    #[tokio::test]
    async fn over_the_cap_the_reading_stops() {
        // Two bytes past the cap, never a newline: the loop stops just past
        // MAX_PAYLOAD rather than reading the rest.
        let mut r = Bytes::owning(vec![b'x'; MAX_PAYLOAD + 2]);
        let buf = read_payload(&mut r).await.unwrap();
        assert!(buf.len() > MAX_PAYLOAD);
        assert!(buf.len() <= MAX_PAYLOAD + 4096);
    }

    #[tokio::test]
    async fn a_broken_connection_reads_nothing() {
        let mut r = Broken;
        assert!(read_payload(&mut r).await.is_none());
    }
}
