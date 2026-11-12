// The system's music, analysed. A loopback capture of the default render
// endpoint — WASAPI turns an output opened for input into its loopback on
// Windows, a PulseAudio monitor source on Linux — feeds the same band meter
// the dictation pill uses, and the levels go out as `music-bands` to the
// island, the desktop Miku and the pill about thirty times a second. Any
// player then dances her the same: Spotify, YouTube Music in a browser, a
// desktop app. The island starts the watch when a dance is welcome and stops
// it the moment it is not — the capture and its FFT are cheap but not free,
// and nothing follows silence.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::Emitter;

use crate::speech::audio::{self, BandMeter};

struct Watch {
    _capture: audio::Capture,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        self._capture.stop();
    }
}

/// One watch at a time: `Some` while the music is worth dancing to.
static WATCH: Mutex<Option<Watch>> = Mutex::new(None);

/// Starts or stops the system-audio watch. Safe to call often: an equal call
/// is a no-op, and a failed capture simply leaves nothing running — the dance
/// falls back to its own rhythm until the next try.
pub fn set_watch(app: &tauri::AppHandle, on: bool) {
    let mut slot = WATCH.lock().unwrap();
    if !on {
        slot.take();
        return;
    }
    if slot.is_some() {
        return;
    }
    let meter = Arc::new(Mutex::new(BandMeter::default()));
    let feed_meter = meter.clone();
    let capture = audio::Capture::start(audio::Source::System, move |samples| {
        feed_meter.lock().unwrap().feed(samples);
    });
    let capture = match capture {
        Ok(c) => c,
        Err(err) => {
            crate::log::line(format!("music: loopback: {err}"));
            return;
        }
    };
    // The audio thread only feeds the meter; this thread hands the levels out.
    let app = app.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_emit = stop.clone();
    let thread = std::thread::Builder::new()
        .name("kanon-music".into())
        .spawn(move || {
            while !stop_emit.load(Ordering::Relaxed) {
                let levels = meter.lock().unwrap().levels;
                let _ = app.emit_to(crate::desktop::LABEL, "music-bands", levels);
                let _ = app.emit_to(crate::island::WINDOW_LABEL, "music-bands", levels);
                let _ = app.emit_to(crate::flow::pill::LABEL, "music-bands", levels);
                std::thread::sleep(Duration::from_millis(33));
            }
        })
        .ok();
    *slot = Some(Watch { _capture: capture, stop, thread });
}

/// The command the island calls when its dance rule flips.
#[tauri::command]
pub fn music_watch(app: tauri::AppHandle, on: bool) {
    set_watch(&app, on);
}

#[cfg(test)]
mod tests {
    use super::set_watch;

    /// End to end: the watch starts, then stops cleanly behind the same call.
    #[test]
    #[ignore] // needs an audio device
    fn watch_starts_and_stops() {
        let app = tauri::test::mock_app().handle().clone();
        set_watch(&app, true);
        set_watch(&app, true);
        set_watch(&app, false);
        set_watch(&app, false);
    }
}
