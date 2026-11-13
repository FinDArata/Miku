// The island's widget deck (src/views/deck.ts): what its pages ask Rust for.
//
// `widget_system` reads this machine on demand while the PC page is on screen,
// whatever the System pill is doing (that pill has its own poller in
// system_health.rs). `widget_weather` asks Open-Meteo for the city the user
// typed on the weather page — the only call it makes, and only once a city is
// set: no location is guessed, nothing is sent until the user asks.

use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use reqwest::Url;
use serde::Serialize;
use sysinfo::{Disks, Networks, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Manager};

use crate::system_health::{pct, Battery};

/// One reading for the PC page.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemSnapshot {
    pub cpu_pct: f64,
    pub ram_pct: f64,
    pub ram_used: u64,
    pub ram_total: u64,
    pub battery: Option<Battery>,
    /// Seconds since the machine started.
    pub uptime: u64,
    pub cores: usize,
    /// The program using the most CPU right now, when one stands out.
    pub top: Option<TopProcess>,
    /// Every fixed disk together, in bytes.
    pub disk_used: u64,
    pub disk_total: u64,
    /// Bytes a second, down and up, over every network adapter.
    pub net_down: f64,
    pub net_up: f64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TopProcess {
    pub name: String,
    /// Share of the whole machine, 0…100.
    pub cpu_pct: f64,
}

/// One System kept between reads: CPU usage is the change since the last one.
static SYSTEM: LazyLock<Mutex<System>> = LazyLock::new(|| Mutex::new(System::new()));
/// The adapters, kept for the same reason: traffic is counted since the last read.
static NETWORKS: LazyLock<Mutex<(Networks, std::time::Instant)>> =
    LazyLock::new(|| Mutex::new((Networks::new_with_refreshed_list(), std::time::Instant::now())));

#[tauri::command]
pub fn widget_system() -> SystemSnapshot {
    let mut system = SYSTEM.lock().unwrap();
    system.refresh_cpu_usage();
    system.refresh_memory();
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cpu());
    let cpus = system.cpus();
    let cores = cpus.len().max(1);
    let cpu = if cpus.is_empty() {
        0.0
    } else {
        cpus.iter().map(|c| f64::from(c.cpu_usage())).sum::<f64>() / cpus.len() as f64
    };
    let top = system
        .processes()
        .values()
        .filter(|p| p.pid().as_u32() != 0)
        .max_by(|a, b| a.cpu_usage().total_cmp(&b.cpu_usage()))
        // A process's figure is per core: divided by the cores it is the
        // machine's share, like the CPU bar above it.
        .map(|p| TopProcess {
            name: p.name().to_string_lossy().to_string(),
            cpu_pct: pct(f64::from(p.cpu_usage()) / cores as f64, 100.0),
        })
        .filter(|p| p.cpu_pct >= 1.0);
    let used = system.used_memory();
    let total = system.total_memory();
    drop(system);
    let disks = Disks::new_with_refreshed_list();
    let (disk_total, disk_free) = disks
        .list()
        .iter()
        .filter(|d| !d.is_removable())
        .fold((0u64, 0u64), |(t, f), d| (t + d.total_space(), f + d.available_space()));
    let (net_down, net_up) = {
        let mut guard = NETWORKS.lock().unwrap();
        let (networks, at) = &mut *guard;
        networks.refresh(true);
        let secs = at.elapsed().as_secs_f64().max(0.5);
        *at = std::time::Instant::now();
        let (down, up) = networks
            .list()
            .values()
            .fold((0u64, 0u64), |(d, u), n| (d + n.received(), u + n.transmitted()));
        (down as f64 / secs, up as f64 / secs)
    };
    SystemSnapshot {
        cpu_pct: pct(cpu, 100.0),
        ram_pct: pct(used as f64, total as f64),
        ram_used: used,
        ram_total: total,
        battery: crate::system_health::battery_now(),
        uptime: System::uptime(),
        cores,
        top,
        disk_used: disk_total.saturating_sub(disk_free),
        disk_total,
        net_down,
        net_up,
    }
}

// ── Weather ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Weather {
    /// The place Open-Meteo found for the city typed.
    pub place: String,
    pub temp: f64,
    pub humidity: f64,
    pub wind: f64,
    /// WMO weather code (0 clear … 99 thunderstorm).
    pub code: u32,
    pub hours: Vec<WeatherHour>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeatherHour {
    /// "15:00", local to the place.
    pub time: String,
    pub temp: f64,
    pub code: u32,
}

const GEOCODE: &str = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST: &str = "https://api.open-meteo.com/v1/forecast";

/// The weather for `city`, which is also remembered as the weather page's city.
/// An empty city forgets it. None when the city is unknown or the service did
/// not answer.
#[tauri::command]
pub async fn widget_weather(app: AppHandle, city: String) -> Option<Weather> {
    let city = city.trim().chars().take(80).collect::<String>();
    if let Some(shared) = app.try_state::<crate::Shared>() {
        let mut s = shared.settings.lock().unwrap();
        if s.weather_city != city {
            s.weather_city = city.clone();
            drop(s);
            crate::settings::save_soon(&app);
        }
    }
    if city.is_empty() {
        return None;
    }
    let mut url = Url::parse(GEOCODE).ok()?;
    url.query_pairs_mut()
        .append_pair("name", &city)
        .append_pair("count", "1")
        .append_pair("format", "json");
    let found = get_json(url).await?;
    let place = found.get("results")?.as_array()?.first()?.clone();
    let lat = place.get("latitude")?.as_f64()?;
    let lon = place.get("longitude")?.as_f64()?;
    let name = place.get("name").and_then(|v| v.as_str()).unwrap_or(&city).to_string();

    let mut url = Url::parse(FORECAST).ok()?;
    url.query_pairs_mut()
        .append_pair("latitude", &format!("{lat:.4}"))
        .append_pair("longitude", &format!("{lon:.4}"))
        .append_pair("current", "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m")
        .append_pair("hourly", "temperature_2m,weather_code")
        .append_pair("forecast_hours", "6")
        .append_pair("timezone", "auto");
    let json = get_json(url).await?;
    Some(parse_forecast(&json, name)?)
}

/// Open-Meteo's forecast answer → the page's shape.
fn parse_forecast(json: &serde_json::Value, place: String) -> Option<Weather> {
    let current = json.get("current")?;
    let num = |v: &serde_json::Value, k: &str| v.get(k).and_then(|x| x.as_f64());
    let hourly = json.get("hourly");
    let times = hourly.and_then(|h| h.get("time")).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let temps = hourly.and_then(|h| h.get("temperature_2m")).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let codes = hourly.and_then(|h| h.get("weather_code")).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let hours = times
        .iter()
        .zip(temps.iter())
        .zip(codes.iter())
        .filter_map(|((t, temp), code)| {
            let t = t.as_str()?;
            Some(WeatherHour {
                // "2026-11-13T15:00" → "15:00"
                time: t.rsplit('T').next().unwrap_or(t).to_string(),
                temp: temp.as_f64()?,
                code: code.as_u64()? as u32,
            })
        })
        .take(6)
        .collect();
    Some(Weather {
        place,
        temp: num(current, "temperature_2m")?,
        humidity: num(current, "relative_humidity_2m").unwrap_or(0.0),
        wind: num(current, "wind_speed_10m").unwrap_or(0.0),
        code: current.get("weather_code").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        hours,
    })
}

async fn get_json(url: Url) -> Option<serde_json::Value> {
    // Only Open-Meteo, over https: the two URLs above are the whole list.
    if url.scheme() != "https" || !url.host_str().is_some_and(|h| h.ends_with("open-meteo.com")) {
        return None;
    }
    let client = crate::net::client(&url, Duration::from_secs(8)).ok()?;
    let response = client.get(url).header("accept", "application/json").send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body = crate::net::read_capped(response, 256 * 1024).await.ok()?;
    serde_json::from_slice(&body).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_forecast_reads_into_the_page_shape() {
        let json: serde_json::Value = serde_json::from_str(r#"{
          "current": { "temperature_2m": 27.4, "relative_humidity_2m": 84, "weather_code": 61, "wind_speed_10m": 9.1 },
          "hourly": { "time": ["2026-11-13T15:00", "2026-11-13T16:00"], "temperature_2m": [27.0, 26.1], "weather_code": [61, 95] }
        }"#).unwrap();
        let w = parse_forecast(&json, "Jakarta".into()).unwrap();
        assert_eq!(w.place, "Jakarta");
        assert_eq!(w.code, 61);
        assert_eq!(w.hours.len(), 2);
        assert_eq!(w.hours[1].time, "16:00");
        assert_eq!(w.hours[1].code, 95);
    }
}
