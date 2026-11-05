// The System pill: how hard this computer is working — CPU, memory, and the
// battery on a laptop.
//
// Nothing leaves the computer: sysinfo reads the counters the OS already keeps,
// and only the numbers reach the island, through the same `integration` event
// every other card uses (integrations.rs). Polling happens only while the pill
// is declared, and it costs one read every three seconds — the smallest interval
// at which the CPU percentage sysinfo reports is still meaningful.
//
// The values are clamped where they are made, not where they are drawn: a
// percentage cannot be 104%, whatever a driver says, and the page shows what
// arrives.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;
use sysinfo::{System, MINIMUM_CPU_UPDATE_INTERVAL};
use tauri::{AppHandle, Emitter};

/// The pill's id. Stable contract value (settings, hook routing): never rename.
pub const PILL_ID: &str = "integration_system";

/// How often the numbers are read. sysinfo needs at least 200 ms between two
/// CPU reads to compute a percentage; three seconds is smooth enough to watch
/// and cheap enough to leave running all day.
const EVERY: Duration = Duration::from_secs(3);

/// What the card is told. `None` means "this machine does not have one" — a
/// desktop has no battery, and that is not an error.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    /// 0…100.
    pub cpu_pct: f64,
    /// 0…100 of the memory in use.
    pub ram_pct: f64,
    /// Memory in use, in bytes.
    pub ram_used: u64,
    /// Total memory, in bytes.
    pub ram_total: u64,
    /// 0…100 and whether it is charging; `None` when there is no battery.
    pub battery: Option<Battery>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    pub pct: f64,
    pub charging: bool,
}

/// A percentage that can be drawn: finite, never below zero, never above 100.
/// A NaN or a negative count (a counter that went backwards) reads as 0.
pub fn pct(part: f64, whole: f64) -> f64 {
    if !part.is_finite() || !whole.is_finite() || whole <= 0.0 {
        return 0.0;
    }
    (part / whole * 100.0).clamp(0.0, 100.0)
}

/// The battery percentage as a driver reports it, clamped. A negative value or
/// a NaN is an unknown reading, not an empty battery: that is `None`.
pub fn battery_pct(level: f32) -> Option<f64> {
    if !level.is_finite() || level < 0.0 {
        return None;
    }
    Some(f64::from(level).clamp(0.0, 100.0))
}

/// Windows' own "no reading" value for a battery percentage: there is no
/// battery at all, or the driver cannot say.
const WINDOWS_UNKNOWN_BATTERY: u8 = 255;

/// What a running poller needs: sysinfo's own counters, and the generation that
/// says whether it is still the one the settings asked for.
struct Shared {
    system: System,
}

static SHARED: Mutex<Option<Shared>> = Mutex::new(None);
/// Bumped every time the pill is switched on or off. A loop that wakes up with
/// an older number stops instead of polling for a pill nobody has.
static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static RUNNING: AtomicBool = AtomicBool::new(false);

/// Reads the counters once. The first call only fills sysinfo's baseline (a CPU
/// percentage needs two reads), which is why the loop reads once before it
/// starts sleeping.
fn read_health(system: &mut System) -> Health {
    system.refresh_cpu_usage();
    system.refresh_memory();
    let cpus = system.cpus();
    // The average across cores, which is what a task manager shows for the
    // machine; sysinfo gives per-core figures only.
    let cpu = if cpus.is_empty() {
        0.0
    } else {
        cpus.iter().map(|c| f64::from(c.cpu_usage())).sum::<f64>() / cpus.len() as f64
    };
    let used = system.used_memory();
    let total = system.total_memory();
    Health {
        cpu_pct: pct(cpu, 100.0),
        ram_pct: pct(used as f64, total as f64),
        ram_used: used,
        ram_total: total,
        battery: read_battery(),
    }
}

/// The battery, when this machine has one. sysinfo does not report batteries on
/// every platform, so a missing one is `None` rather than an error.
#[cfg(windows)]
fn read_battery() -> Option<Battery> {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    // SAFETY: the structure is plain data the call fills in; the API reads the
    // machine's power state and touches nothing we own.
    let mut status = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut status) }.ok()?;
    // BatteryLifePercent is 255 when the machine has no battery (a desktop) or
    // the driver cannot say: no battery, not a full one.
    if status.BatteryLifePercent == WINDOWS_UNKNOWN_BATTERY {
        return None;
    }
    let pct = battery_pct(f32::from(status.BatteryLifePercent))?;
    Some(Battery {
        pct,
        // ACOnline when the charger is in, or the battery is full and the
        // charger is not needed: either way the card should not say "dying".
        charging: status.ACLineStatus == 1,
    })
}

#[cfg(target_os = "linux")]
fn read_battery() -> Option<Battery> {
    // /sys/class/power_supply/BAT*, read as the kernel publishes it: capacity
    // is a percentage, status is "Charging"/"Discharging"/"Full"/"Unknown".
    let entries = std::fs::read_dir("/sys/class/power_supply").ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.file_name().is_some_and(|n| n.to_string_lossy().starts_with("BAT")) {
            continue;
        }
        let capacity = std::fs::read_to_string(path.join("capacity")).ok()?;
        let level: f32 = capacity.trim().parse().ok()?;
        let Some(pct) = battery_pct(level) else { continue };
        let status = std::fs::read_to_string(path.join("status")).unwrap_or_default();
        let charging = matches!(status.trim(), "Charging" | "Full");
        return Some(Battery { pct, charging });
    }
    None
}

/// Any other OS: no battery reading here.
#[cfg(not(any(windows, target_os = "linux")))]
fn read_battery() -> Option<Battery> {
    None
}

/// How often the battery alone is read, whatever the pill is doing. Mochi on
/// the desktop reacts to it (charging, and a low battery), and that is not
/// something the user should have to declare a pill for.
const BATTERY_EVERY: Duration = Duration::from_secs(60);

/// The last battery reading sent to the island, so one change is one event.
static LAST_BATTERY: Mutex<Option<Battery>> = Mutex::new(None);

/// Starts the battery watch: one reading a minute, on every build, whether or
/// not the System pill is declared. A reading that has not changed is not sent.
pub fn start_battery_watch(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("miku-battery".into())
        .spawn(move || loop {
            let reading = read_battery();
            let changed = {
                let mut last = LAST_BATTERY.lock().unwrap();
                if *last == reading {
                    false
                } else {
                    *last = reading.clone();
                    true
                }
            };
            if changed {
                if let Some(reading) = &reading {
                    let _ = app.emit_to(
                        crate::island::WINDOW_LABEL,
                        "battery",
                        json!({ "pct": reading.pct, "charging": reading.charging }),
                    );
                }
            }
            std::thread::sleep(BATTERY_EVERY);
        });
    if let Err(err) = spawned {
        crate::log::line(format!("system: no battery watch thread: {err}"));
    }
}

/// Turns the poller on or off, from the settings' declared pills — the same
/// call shape as spotify::sync.
pub fn sync(app: &AppHandle, active_integrations: &[String]) {
    let on = active_integrations.iter().any(|id| id == PILL_ID);
    set_active(app, on);
}

fn set_active(app: &AppHandle, on: bool) {
    let generation = {
        let mut shared = SHARED.lock().unwrap();
        let running = RUNNING.load(Ordering::SeqCst);
        if running == on {
            return;
        }
        RUNNING.store(on, Ordering::SeqCst);
        let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        if on {
            // A fresh System reads this machine's memory and core count; the
            // same one is reused by the loop below so its CPU baseline builds
            // up over time instead of starting from nothing every tick.
            *shared = Some(Shared { system: System::new() });
        } else {
            *shared = None;
        }
        generation
    };
    if !on {
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("miku-system".into())
        .spawn(move || poll(&app, generation));
    if let Err(err) = spawned {
        crate::log::line(format!("system: no poller thread: {err}"));
        RUNNING.store(false, Ordering::SeqCst);
    }
}

/// One reading, as the island's `integration` event carries it (integrations.rs).
fn emit(app: &AppHandle, health: &Health) {
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "integration", json!({
        "id": PILL_ID,
        "data": health,
        "error": null,
        "event": null,
    }));
}

/// Reads, tells, sleeps, until the generation it started with is gone.
fn poll(app: &AppHandle, generation: u64) {
    // The first read only fills the CPU baseline: it is not worth sending.
    let mut first = true;
    loop {
        if GENERATION.load(Ordering::SeqCst) != generation || !RUNNING.load(Ordering::SeqCst) {
            return;
        }
        let health = {
            let mut guard = SHARED.lock().unwrap();
            let Some(shared) = guard.as_mut() else { return };
            read_health(&mut shared.system)
        };
        if first {
            first = false;
        } else {
            emit(app, &health);
        }
        std::thread::sleep(EVERY.max(MINIMUM_CPU_UPDATE_INTERVAL));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_percentage_stays_between_zero_and_a_hundred() {
        assert_eq!(pct(0.0, 16.0), 0.0);
        assert_eq!(pct(8.0, 16.0), 50.0);
        assert_eq!(pct(16.0, 16.0), 100.0);
        // A count that goes past the whole (a driver's rounding) is 100, not 104.
        assert_eq!(pct(17.0, 16.0), 100.0);
        // Nothing to divide by, or a count that went backwards: zero, not NaN.
        assert_eq!(pct(5.0, 0.0), 0.0);
        assert_eq!(pct(5.0, -1.0), 0.0);
        assert_eq!(pct(f64::NAN, 16.0), 0.0);
        assert_eq!(pct(5.0, f64::INFINITY), 0.0);
    }

    #[test]
    fn a_battery_level_is_clamped_and_a_missing_one_is_none() {
        assert_eq!(battery_pct(0.0), Some(0.0));
        // An f32 driver value read as f64 carries its own rounding with it.
        assert_eq!(battery_pct(87.4).map(|v| v.round()), Some(87.0));
        assert_eq!(battery_pct(100.0), Some(100.0));
        // Above 100 is a driver's rounding, and is clamped to a full battery;
        // a negative value and a NaN are unknown readings, which are no level.
        assert_eq!(battery_pct(255.0), Some(100.0));
        assert_eq!(battery_pct(-1.0), None);
        assert_eq!(battery_pct(f32::NAN), None);
    }

    #[test]
    fn the_health_goes_out_in_the_integration_shape() {
        let health = Health {
            cpu_pct: 12.5,
            ram_pct: 40.0,
            ram_used: 8_000_000_000,
            ram_total: 20_000_000_000,
            battery: Some(Battery { pct: 66.0, charging: true }),
        };
        let json = serde_json::to_value(&health).unwrap();
        assert_eq!(json["cpuPct"], 12.5);
        assert_eq!(json["ramPct"], 40.0);
        assert_eq!(json["battery"]["pct"], 66.0);
        assert_eq!(json["battery"]["charging"], true);
        // A desktop's battery is null, which the page draws as no battery.
        let desktop = Health { battery: None, ..health };
        assert!(serde_json::to_value(&desktop).unwrap()["battery"].is_null());
    }

    #[test]
    fn a_real_reading_is_between_zero_and_a_hundred() {
        let mut system = System::new();
        system.refresh_memory();
        let health = read_health(&mut system);
        assert!((0.0..=100.0).contains(&health.cpu_pct), "cpu {}", health.cpu_pct);
        assert!((0.0..=100.0).contains(&health.ram_pct), "ram {}", health.ram_pct);
        // Any machine this runs on has memory; a zero total is a read that failed.
        assert!(health.ram_total > 0, "total memory was {}", health.ram_total);
        assert!(health.ram_used <= health.ram_total);
        if let Some(battery) = health.battery {
            assert!((0.0..=100.0).contains(&battery.pct));
        }
    }
}
