// The Miku window's character stage ("Mochi Stage"): the state its character
// wears, as the hub page itself cannot know it — the hook events reach the
// island's window only (pipe.rs), and a command has to hand a snapshot over.
//
// Four states, in the order they are asked:
//   * any agent waiting for a permission decision → "waiting-permission"
//     (the relay's `Pending` map, exactly what makes the island show its card);
//   * else any session with a turn under way → "running";
//   * else a turn ended very recently → "clear";
//   * else "idle".
//
// A turn is under way from any activity event (SessionStart, UserPromptSubmit,
// the tool events…) and ends with Stop, StopFailure, Interrupt or SessionEnd —
// the same events the island's hooks.ts uses. A "running" session seen for too
// long without an event stops holding the stage: a Stop lost to a crash or a
// closed terminal must not leave it "running" forever.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::HUB_LABEL;

/// A "running" session this long without an event is considered gone.
const RUNNING_STALE: Duration = Duration::from_secs(5 * 60);
/// How long after a turn ended the stage still shows "clear".
const CLEAR_WINDOW: Duration = Duration::from_secs(60);
/// Finished sessions are forgotten once "clear" cannot apply any more.
const PRUNE_AFTER: Duration = Duration::from_secs(3600);

/// Events that show a session's turn is under way, and keep it so.
/// `Notification` is deliberately absent: Claude Code also sends it when the
/// agent is idle waiting for input (the island gates it on message text), and
/// treating it as activity would show "running" on an idle machine. Permission
/// prompts reach "waiting-permission" through `Pending` instead.
const ACTIVE: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "SubagentStart",
    "SubagentStop",
];

/// Events that end a turn or the session (island hooks.ts `TURN_OVER` + Stop).
const OVER: &[&str] = &["Stop", "StopFailure", "Interrupt", "SessionEnd"];

#[derive(Default)]
struct Tracker {
    /// Session ID → when the session was last heard of. Only sessions that may
    /// still be running are kept; a turn-over event removes theirs.
    running: HashMap<String, Instant>,
    /// The last time any turn ended, for the "clear" state.
    finished: Option<Instant>,
}

impl Tracker {
    /// Records one hook event. Only activity and turn-over events matter.
    fn observe(&mut self, event: &str, session: &str, now: Instant) {
        if ACTIVE.contains(&event) {
            self.running.insert(session.to_string(), now);
        } else if OVER.contains(&event) {
            self.running.remove(session);
            self.finished = Some(now);
        }
    }

    /// Drops stale sessions and ancient finish marks; nothing else reads them.
    fn prune(&mut self, now: Instant) {
        self.running.retain(|_, last| now.duration_since(*last) < PRUNE_AFTER);
        if let Some(t) = self.finished {
            if now.duration_since(t) >= PRUNE_AFTER {
                self.finished = None;
            }
        }
    }

    /// The stage's state: waiting beats running beats clear beats idle.
    fn state(&self, waiting: bool, now: Instant) -> &'static str {
        if waiting {
            return "waiting-permission";
        }
        if self
            .running
            .values()
            .any(|last| now.duration_since(*last) < RUNNING_STALE)
        {
            return "running";
        }
        if let Some(t) = self.finished {
            if now.duration_since(t) < CLEAR_WINDOW {
                return "clear";
            }
        }
        "idle"
    }
}

/// `None` until the first event: `HashMap::new` is not const, so the tracker
/// is built on first use instead (`get_or_insert_with`).
static TRACKER: Mutex<Option<Tracker>> = Mutex::new(None);

fn tracker() -> std::sync::MutexGuard<'static, Option<Tracker>> {
    TRACKER.lock().unwrap_or_else(|e| e.into_inner())
}

/// Whether a permission request is waiting for a human right now.
fn waiting(app: &AppHandle) -> bool {
    let pending = app.state::<crate::pipe::Pending>();
    let map = pending.0.lock().unwrap_or_else(|e| e.into_inner());
    let waiting = !map.is_empty();
    waiting
}

/// What the hub window was told last, so an unchanged state is not re-emitted.
static EMITTED: Mutex<Option<String>> = Mutex::new(None);

/// A hook event went through the relay: remember what it says about its
/// session. `session` may be empty — such events share one bucket, so a
/// sessionless agent still moves the stage.
pub fn observe(event: &str, session: &str) {
    // Only what Claude Code sends (a UUID) is worth a bucket, like session_window.
    let session = if session.len() <= 128 { session } else { "" };
    let now = Instant::now();
    tracker()
        .get_or_insert_with(Tracker::default)
        .observe(event, session, now);
}

/// Recomputes the state and, when it changed, tells the hub window ("hub-stage").
/// Called wherever something it reads moves: each hook event, and each time a
/// pending permission request is taken out of `Pending`.
pub fn refresh(app: &AppHandle) {
    let waiting = waiting(app);
    let now = Instant::now();
    let state = {
        let mut guard = tracker();
        let tracker = guard.get_or_insert_with(Tracker::default);
        tracker.prune(now);
        tracker.state(waiting, now)
    };
    let mut emitted = EMITTED.lock().unwrap_or_else(|e| e.into_inner());
    if emitted.as_deref() != Some(state) {
        *emitted = Some(state.to_string());
        let _ = app.emit_to(HUB_LABEL, "hub-stage", state);
    }
}

/// The stage's state for the hub page, which polls it while it is on screen.
/// Same words the frontend's `StageState` uses, so the answer is one to one.
#[tauri::command]
pub fn hub_stage_state(app: AppHandle) -> String {
    let waiting = waiting(&app);
    let now = Instant::now();
    let mut guard = tracker();
    let tracker = guard.get_or_insert_with(Tracker::default);
    tracker.prune(now);
    tracker.state(waiting, now).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One test on purpose: the tracker is a process-wide static, and its
    /// instants have to stay ordered.
    #[test]
    fn the_stage_follows_waiting_running_clear_and_idle_in_that_order() {
        let t0 = Instant::now();
        let mut tracker = Tracker::default();

        // Nothing seen: idle.
        assert_eq!(tracker.state(false, t0), "idle");
        // A permission waiting wins over everything else.
        assert_eq!(tracker.state(true, t0), "waiting-permission");

        // A session starts working.
        tracker.observe("SessionStart", "s1", t0);
        assert_eq!(tracker.state(false, t0), "running");
        // Activity of another session keeps the stage running, and one that
        // finished recently still does not beat a session at work.
        tracker.observe("PostToolUse", "s2", t0 + Duration::from_secs(10));
        tracker.observe("Stop", "s3", t0 + Duration::from_secs(10));
        assert_eq!(tracker.state(false, t0 + Duration::from_secs(11)), "running");

        // All work over: "clear" for a short while, then back to idle.
        tracker.observe("Stop", "s1", t0 + Duration::from_secs(20));
        tracker.observe("SessionEnd", "s2", t0 + Duration::from_secs(20));
        assert_eq!(tracker.state(false, t0 + Duration::from_secs(21)), "clear");
        // The window opened at t0+20, so it closes just after t0+80.
        assert_eq!(tracker.state(false, t0 + Duration::from_secs(81)), "idle");
        // A waiting request while "clear": waiting wins.
        tracker.observe("Stop", "s4", t0 + Duration::from_secs(62));
        assert_eq!(tracker.state(true, t0 + Duration::from_secs(63)), "waiting-permission");
        assert_eq!(tracker.state(false, t0 + Duration::from_secs(63)), "clear");

        // A session silent for too long stops holding the stage on "running"…
        tracker.observe("UserPromptSubmit", "s5", t0 + Duration::from_secs(64));
        assert_eq!(tracker.state(false, t0 + Duration::from_secs(65)), "running");
        assert_eq!(
            tracker.state(false, t0 + Duration::from_secs(64) + RUNNING_STALE + Duration::from_secs(1)),
            "idle",
            "the stale session lets go, and s4's clear window has closed by then too"
        );
        // A fresh finish opens the window again — and it closes on its own.
        tracker.observe("Stop", "s6", t0 + Duration::from_secs(370));
        assert_eq!(tracker.state(false, t0 + Duration::from_secs(371)), "clear");
        assert_eq!(tracker.state(false, t0 + Duration::from_secs(431)), "idle");
        // …and pruning forgets it and ancient finish marks entirely.
        tracker.prune(t0 + Duration::from_secs(64) + PRUNE_AFTER);
        assert_eq!(
            tracker.state(false, t0 + Duration::from_secs(64) + PRUNE_AFTER),
            "idle"
        );

        // An event without a session shares one bucket, so it still counts.
        let mut tracker = Tracker::default();
        tracker.observe("PreToolUse", "", t0);
        assert_eq!(tracker.state(false, t0), "running");
        tracker.observe("Stop", "", t0);
        assert_eq!(tracker.state(false, t0 + Duration::from_secs(1)), "clear");

        // StatusLine says nothing about activity; a subagent finishing does
        // count as one, the same way its start does.
        let mut tracker = Tracker::default();
        tracker.observe("StatusLine", "s", t0);
        tracker.observe("SubagentStop", "s", t0);
        assert_eq!(tracker.state(false, t0), "running");
        assert_eq!(tracker.state(false, t0 + RUNNING_STALE), "idle");
    }
}
