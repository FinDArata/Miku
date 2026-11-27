// Google Calendar, read-only, through the calendar's own private iCal address
// (Google Calendar → Settings → Integrate calendar → Secret address in iCal
// format). The URL lives in the Credential Manager under `gcal-ics-url`; the
// island's own notes stay in localStorage — nothing here writes to Google.
//
// The command is stateless: each call fetches, parses and answers, and the
// island's Calendar page decides how long to keep the answer and when to ask
// again. The parser is deliberately small: VEVENT blocks with DTSTART and
// SUMMARY, STATUS:CANCELLED, EXDATE, and the recurrence rules a personal
// calendar actually keeps (FREQ = DAILY / WEEKLY / MONTHLY / YEARLY, with
// COUNT, UNTIL and INTERVAL, and BYDAY as Google writes it for weekly
// repetitions). A rule the parser cannot read still shows its first
// occurrence — one event beats no event. Multi-day spans (DTEND, DURATION)
// draw on their first day only, a TZID time keeps its wall clock, and a Z
// time is drawn in the computer's zone.

use std::collections::HashSet;

use chrono::Datelike;
use serde::Serialize;

use crate::i18n::{t, tf};
use crate::net;
use crate::secrets;

/// The Credential Manager key holding the private iCal address.
pub const URL_KEY: &str = "gcal-ics-url";
/// An ICS body ceiling: a private calendar stays far below this.
const MAX_BODY: usize = 8 * 1024 * 1024;
/// The window occurrences are expanded into, in days: enough into the past
/// for a month grid to land in it, a year ahead for the recurrences.
const PAST_DAYS: i64 = 92;
const FUTURE_DAYS: i64 = 370;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IcsEvent {
    /// "YYYY-MM-DD", the local day the event starts on.
    pub date: String,
    /// "HH:mm" in the local day, absent for an all-day event.
    pub time: Option<String>,
    pub title: String,
}

/// Fetches and parses the calendar now. The URL may come in (the Calendar
/// page tests one that is not saved yet) or be read from the Credential
/// Manager; without either there is nothing to fetch.
#[tauri::command]
pub async fn ics_fetch(url: Option<String>) -> Result<Vec<IcsEvent>, String> {
    let raw = match url {
        Some(u) if !u.trim().is_empty() => u,
        _ => secrets::get(URL_KEY).ok_or_else(|| t("No calendar address is set."))?,
    };
    let raw = raw.trim();
    if !raw.starts_with("https://") && !raw.starts_with("http://") {
        return Err(t("The address must start with http:// or https://."));
    }
    let url = reqwest::Url::parse(raw).map_err(|_| tf("Not a valid address: {address}", &[("address", raw)]))?;
    let response = net::client(&url).get(url).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let body = net::read_capped(response, MAX_BODY).await?;
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }
    Ok(parse_ics(&String::from_utf8_lossy(&body)))
}

/// Turns the feed into the events the window (PAST_DAYS back, FUTURE_DAYS
/// ahead) asks for. Properties the page does not draw — DESCRIPTION,
/// LOCATION, ATTENDEE — are simply skipped.
fn parse_ics(text: &str) -> Vec<IcsEvent> {
    let (from, to) = window();
    let mut out: Vec<IcsEvent> = Vec::new();
    let mut cur = Current::default();
    for line in unfolded(text).lines() {
        let (name, value) = match line.split_once(':') {
            Some((n, v)) => (n.to_ascii_uppercase(), v),
            None => continue,
        };
        match (name.split(';').next().unwrap_or_default(), value) {
            ("BEGIN", "VEVENT") => cur = Current::default(),
            ("END", "VEVENT") => out.extend(cur.take(from, to)),
            ("SUMMARY", v) => cur.summary = Some(unescape(v)),
            ("STATUS", v) if v.eq_ignore_ascii_case("CANCELLED") => cur.cancelled = true,
            ("DTSTART", v) => cur.start = Some(Dt::parse(v)),
            ("RRULE", v) => cur.rrule = Some(v.to_string()),
            ("EXDATE", v) => cur.exdates.extend(v.split(',').map(str::to_string)),
            _ => {}
        }
    }
    out.extend(cur.take(from, to));
    out
}

/// The window the occurrences are expanded into, in days from the epoch.
fn window() -> (i64, i64) {
    let today = today_epoch();
    (today - PAST_DAYS, today + FUTURE_DAYS)
}

/// Unfolds the folded lines (RFC 5545 §3.1): a line starting with a space or
/// a tab continues the one before it, the one whitespace going.
fn unfolded(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for raw in text.lines() {
        let raw = raw.trim_end_matches('\r');
        if (raw.starts_with(' ') || raw.starts_with('\t')) && !out.is_empty() {
            out.push_str(&raw[1..]);
        } else {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(raw);
        }
    }
    out
}

/// One VEVENT being read, turned into its occurrences on its END.
#[derive(Default)]
struct Current {
    summary: Option<String>,
    start: Option<Dt>,
    rrule: Option<String>,
    exdates: Vec<String>,
    cancelled: bool,
}

impl Current {
    /// The event's occurrences, or nothing when it is cancelled, untitled or
    /// has no readable start.
    fn take(&mut self, from: i64, to: i64) -> Vec<IcsEvent> {
        if self.cancelled {
            return Vec::new();
        }
        let (Some(start), Some(title)) = (self.start.take(), self.summary.take()) else {
            return Vec::new();
        };
        let title = title.trim();
        if title.is_empty() {
            return Vec::new();
        }
        let Some(epoch) = start.epoch else { return Vec::new() };
        let exdates: HashSet<i64> = self
            .exdates
            .drain(..)
            .filter_map(|d| {
                let d = d.trim();
                day_number(&dash(d.get(..8).unwrap_or(d)))
            })
            .collect();
        match self.rrule.take().map(|r| Rule::parse(&r)) {
            Some(rule) => expand(&start, epoch, &rule, &exdates, title, from, to),
            None if epoch >= from && epoch <= to && !exdates.contains(&epoch) => {
                vec![IcsEvent { date: start.day, time: start.clock, title: title.to_string() }]
            }
            None => Vec::new(),
        }
    }
}

/// A DTSTART value: the local day it starts on ("YYYY-MM-DD"), the clock
/// ("HH:mm") for a date-time, and the day as days from the epoch.
struct Dt {
    day: String,
    clock: Option<String>,
    epoch: Option<i64>,
}

impl Dt {
    /// Parses one DTSTART value: a date ("YYYYMMDD") or a date-time
    /// ("YYYYMMDDTHHMMSS", with an optional trailing Z). A Z time is drawn
    /// in the computer's zone; a TZID time keeps its wall clock, which is
    /// right whenever the calendar's zone is this computer's — the usual
    /// case for a personal calendar.
    fn parse(value: &str) -> Dt {
        let v = value.trim();
        let (raw_day, raw_clock) = if v.len() >= 13 && v.as_bytes().get(8) == Some(&b'T') {
            (v.get(..8), Some(v.get(9..13).unwrap_or_default()))
        } else {
            (Some(v), None)
        };
        let Some(raw_day) = raw_day else {
            return Dt { day: String::new(), clock: None, epoch: None };
        };
        let Some(clock) = raw_clock else {
            return Dt { day: dash(raw_day), clock: None, epoch: day_number(&dash(raw_day)) };
        };
        let hh: i64 = clock.get(..2).and_then(|x| x.parse().ok()).unwrap_or(0);
        let mm: i64 = clock.get(2..4).and_then(|x| x.parse().ok()).unwrap_or(0);
        if v.ends_with('Z') {
            // The moment is UTC day + seconds; the local wall clock is that
            // shifted by the computer's offset, which may move the day.
            let secs = day_number(&dash(raw_day)).unwrap_or(0) * 86_400 + hh * 3_600 + mm * 60 + local_offset_secs();
            let epoch = secs.div_euclid(86_400);
            let minutes = secs.rem_euclid(86_400) / 60;
            Dt { day: day_string(epoch), clock: Some(clock_string(minutes)), epoch: Some(epoch) }
        } else {
            Dt { day: dash(raw_day), clock: Some(clock_string(hh * 60 + mm)), epoch: day_number(&dash(raw_day)) }
        }
    }
}

/// One RRULE, only the parts a personal calendar keeps.
struct Rule {
    freq: Freq,
    interval: i64,
    count: Option<i64>,
    until: Option<i64>,
    bydays: Vec<i64>,
}

#[derive(Clone, Copy)]
enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

impl Rule {
    fn parse(raw: &str) -> Rule {
        let mut rule = Rule { freq: Freq::Daily, interval: 1, count: None, until: None, bydays: Vec::new() };
        for part in raw.split(';') {
            let Some((k, v)) = part.split_once('=') else { continue };
            let v = v.trim();
            match k.trim().to_ascii_uppercase().as_str() {
                "FREQ" => {
                    rule.freq = match v.to_ascii_uppercase().as_str() {
                        "WEEKLY" => Freq::Weekly,
                        "MONTHLY" => Freq::Monthly,
                        "YEARLY" => Freq::Yearly,
                        _ => Freq::Daily,
                    };
                }
                "INTERVAL" => rule.interval = v.parse::<i64>().unwrap_or(1).max(1),
                "COUNT" => rule.count = v.parse::<i64>().ok(),
                // UNTIL may be a date or a date-time; the day decides.
                "UNTIL" => rule.until = v.get(..8).and_then(|d| day_number(&dash(d))),
                "BYDAY" => rule.bydays = v.split(',').filter_map(weekday_index).collect(),
                _ => {}
            }
        }
        rule
    }
}

/// "MO" … "SU", with the ordinal prefix Google's weekly rules never carry.
fn weekday_index(day: &str) -> Option<i64> {
    match day.trim_start_matches(['-', '+']).trim_start_matches(char::is_numeric) {
        "MO" => Some(0),
        "TU" => Some(1),
        "WE" => Some(2),
        "TH" => Some(3),
        "FR" => Some(4),
        "SA" => Some(5),
        "SU" => Some(6),
        _ => None,
    }
}

/// Every occurrence the rule makes inside the window, walked day by day —
/// the window is 462 days, so the walk is short however the rule repeats.
/// COUNT counts every occurrence the rule makes, the ones the window hides
/// included, and UNTIL ends the walk, as RFC 5545 asks.
fn expand(
    start: &Dt,
    epoch: i64,
    rule: &Rule,
    exdates: &HashSet<i64>,
    title: &str,
    from: i64,
    to: i64,
) -> Vec<IcsEvent> {
    let start_weekday = weekday_mon0(epoch);
    let start_month = month_index(epoch);
    let start_dom = day_of_month(epoch);
    let (start_m, start_d) = (month_of(epoch), start_dom);
    let start_year = year_of(epoch);
    let mut out = Vec::new();
    let mut seen = 0i64;
    let mut day = epoch;
    while day <= to && rule.count.map(|c| seen < c).unwrap_or(true) {
        if rule.until.map(|u| day > u).unwrap_or(false) {
            break;
        }
        let keep = match rule.freq {
            Freq::Daily => (day - epoch) % rule.interval == 0,
            Freq::Weekly => {
                let weekday = weekday_mon0(day);
                let day_ok = if rule.bydays.is_empty() { weekday == start_weekday } else { rule.bydays.contains(&weekday) };
                day_ok && (week_monday(day) - week_monday(epoch)) / 7 % rule.interval == 0
            }
            Freq::Monthly => day_of_month(day) == start_dom && (month_index(day) - start_month) % rule.interval == 0,
            Freq::Yearly => {
                month_of(day) == start_m && day_of_month(day) == start_d && (year_of(day) - start_year) % rule.interval == 0
            }
        };
        if keep {
            seen += 1;
            if day >= from && !exdates.contains(&day) {
                out.push(IcsEvent { date: day_string(day), time: start.clock.clone(), title: title.to_string() });
            }
        }
        day += 1;
    }
    out
}

/// The day's weekday, Monday 0 … Sunday 6: the epoch began on a Thursday.
fn weekday_mon0(day: i64) -> i64 {
    (day + 3).rem_euclid(7)
}

/// The Monday of the day's week, in days from the epoch.
fn week_monday(day: i64) -> i64 {
    day - weekday_mon0(day)
}

/// The month the day sits in, counted from January 1970.
fn month_index(day: i64) -> i64 {
    let (y, m, _) = civil(day);
    (y - 1970) * 12 + m - 1
}

fn day_of_month(day: i64) -> i64 {
    civil(day).2
}

fn month_of(day: i64) -> i64 {
    civil(day).1
}

fn year_of(day: i64) -> i64 {
    civil(day).0
}

/// The day, as a (year, month, day) triple.
fn civil(day: i64) -> (i64, i64, i64) {
    civil_from_days(day)
}

/// Today, the computer's local day, as days from the epoch.
fn today_epoch() -> i64 {
    let now = chrono::Local::now();
    days_from_civil(now.year() as i64, now.month() as i64, now.day() as i64)
}

/// The computer's offset from UTC, in seconds.
fn local_offset_secs() -> i64 {
    chrono::Local::now().offset().local_minus_utc() as i64
}

/// "YYYYMMDD" → "YYYY-MM-DD"; a dashed value goes through.
fn dash(d: &str) -> String {
    if d.len() == 8 && d.bytes().all(|b| b.is_ascii_digit()) {
        format!("{}-{}-{}", &d[..4], &d[4..6], &d[6..8])
    } else {
        d.to_string()
    }
}

/// "YYYY-MM-DD" → days from 1970-01-01; None when it is not a date.
fn day_number(day: &str) -> Option<i64> {
    if day.len() != 10 {
        return None;
    }
    let y: i64 = day.get(..4)?.parse().ok()?;
    let m: i64 = day.get(5..7)?.parse().ok()?;
    let d: i64 = day.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(days_from_civil(y, m, d))
}

/// Days from the epoch → "YYYY-MM-DD".
fn day_string(day: i64) -> String {
    let (y, m, d) = civil_from_days(day);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Minutes from midnight → "HH:mm".
fn clock_string(minutes: i64) -> String {
    format!("{:02}:{:02}", minutes / 60, minutes % 60)
}

/// Days since 1970-01-01 (Howard Hinnant's algorithm), no date library.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The reverse: days since the epoch → (year, month, day).
fn civil_from_days(day: i64) -> (i64, i64, i64) {
    let z = day + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Unescapes the text ICS escaping: `\,` `\;` `\n` `\\`.
fn unescape(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    let mut esc = false;
    for c in v.chars() {
        if esc {
            esc = false;
            match c {
                'n' | 'N' => out.push('\n'),
                other => out.push(other),
            }
        } else if c == '\\' {
            esc = true;
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_round_trip() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(day_string(0), "1970-01-01");
        assert_eq!(day_string(days_from_civil(2026, 11, 26)), "2026-11-26");
        assert_eq!(day_string(days_from_civil(2000, 2, 29)), "2000-02-29");
        assert_eq!(day_number("2026-12-01"), Some(days_from_civil(2026, 12, 1)));
        assert_eq!(dash("20261201"), "2026-12-01");
    }

    #[test]
    fn weekday_counts_from_monday() {
        // 1970-01-01 was a Thursday; 2026-11-23 was a Monday.
        assert_eq!(weekday_mon0(0), 3);
        assert_eq!(weekday_mon0(days_from_civil(2026, 11, 23)), 0);
    }

    #[test]
    fn parses_a_plain_feed() {
        let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Halo dunia\r\nDTSTART;VALUE=DATE:20261201\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Rapat\\, pagi\r\nDTSTART:20261202T090000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Dibatalkan\r\nDTSTART:20261203T100000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR";
        let events = parse_ics(ics);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].date, "2026-12-01");
        assert_eq!(events[0].time, None);
        assert_eq!(events[1].title, "Rapat, pagi");
        assert_eq!(events[1].time.as_deref(), Some("09:00"));
    }

    #[test]
    fn unfolds_folded_lines() {
        let ics = "BEGIN:VEVENT\r\nSUMMARY:Satu kalimat\r\n  panjang\r\nDTSTART;VALUE=DATE:20261201\r\nEND:VEVENT";
        let events = parse_ics(ics);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].title, "Satu kalimat panjang");
    }

    #[test]
    fn expands_a_weekly_rule() {
        // Tuesdays and Thursdays from 2026-01-06 (a Tuesday), through January.
        let epoch = days_from_civil(2026, 1, 6);
        let start = Dt { day: "2026-01-06".into(), clock: Some("09:00".into()), epoch: Some(epoch) };
        let rule = Rule::parse("FREQ=WEEKLY;BYDAY=TU,TH");
        let out = expand(&start, epoch, &rule, &HashSet::new(), "Rapat", days_from_civil(2026, 1, 1), days_from_civil(2026, 1, 31));
        assert_eq!(out.len(), 8); // the 1st is before the start: 6, 8, 13, 15, 20, 22, 27, 29
        assert_eq!(out[0].date, "2026-01-06");
        assert_eq!(out[1].date, "2026-01-08");
        assert_eq!(out[1].time.as_deref(), Some("09:00"));
    }

    #[test]
    fn a_daily_rule_honours_count_and_exdate() {
        let epoch = days_from_civil(2026, 1, 1);
        let start = Dt { day: "2026-01-01".into(), clock: None, epoch: Some(epoch) };
        let rule = Rule::parse("FREQ=DAILY;COUNT=5");
        let ex: HashSet<i64> = [days_from_civil(2026, 1, 3)].into_iter().collect();
        let out = expand(&start, epoch, &rule, &ex, "Harian", epoch, days_from_civil(2026, 1, 31));
        // COUNT=5 makes January 1..5; the 3rd is excluded.
        assert_eq!(out.len(), 4);
        assert_eq!(out[2].date, "2026-01-04");
        assert_eq!(out[2].time, None);
    }
}
