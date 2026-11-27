// Google's calendar, the Calendar page's read-only side: events read from a
// calendar's private iCal address (Google Calendar → Settings → "Integrate
// calendar"). The fetch and the parsing live in Rust (src-tauri/src/ics.rs);
// the address itself never comes here — it stays in the Credential Manager,
// and this window only learns whether it is set. Nothing writes to Google.
//
// Storage: the last answer, in localStorage of the island's own window next
// to the local notes — a copy for display, safe to drop: the next refresh
// rebuilds it from the feed. Miku's own notes never leave the computer.

import { Bridge } from "./bridge";
import { State } from "./state";

/** One event of the Google feed, already in the local day. */
export interface GcalEntry {
  /** "YYYY-MM-DD", the local day it starts on. */
  date: string;
  /** "HH:mm", absent for an all-day event. */
  time?: string;
  title: string;
}

const KEY = "miku.calendar.gcal";
/** The feed is asked again after this long: Google's own advice for iCal. */
const STALE_MS = 30 * 60 * 1000;

let entries: GcalEntry[] = load();
/** Rises when what the Calendar page draws changed (deck pageKey). */
let changes = 0;
/** Unix ms of the last successful fetch; 0 while there is none. */
let fetchedAt = 0;
/** Whether a calendar address is set, as the last refresh saw it. */
let isPresent: boolean | null = null;
/** Why the last fetch failed, once there is an address to show. */
let lastError: string | null = null;
let busy = false;
/** When the feed was last asked, asked or not: a failed fetch also waits out
 * the window, or every render would knock on a dead address forever. */
let lastAttempt = 0;

interface Stored {
  fetchedAt: number;
  entries: GcalEntry[];
}

function load(): GcalEntry[] {
  try {
    const raw = window.localStorage?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return [];
    const at = (parsed as { fetchedAt?: unknown }).fetchedAt;
    const list = (parsed as { entries?: unknown }).entries;
    if (!Array.isArray(list)) return [];
    if (typeof at === "number") fetchedAt = at;
    return list.filter(
      (e): e is GcalEntry =>
        typeof e === "object" && e !== null && typeof (e as GcalEntry).date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test((e as GcalEntry).date) && typeof (e as GcalEntry).title === "string",
    );
  } catch {
    return [];
  }
}

function save() {
  try {
    const stored: Stored = { fetchedAt, entries };
    window.localStorage?.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Full or blocked storage: the events just stay in memory.
  }
}

function changed() {
  changes++;
  save();
  State.notify();
}

/** How many times the Google events changed (deck pageKey). */
export function version(): number {
  return changes;
}

/** Whether a calendar address is set, as the last refresh saw it — null
 * before the first one. */
export function present(): boolean | null {
  return isPresent;
}

/** Why the last fetch failed; null after a good one. */
export function error(): string | null {
  return lastError;
}

/** The day's events, in time order. */
export function of(date: string): GcalEntry[] {
  return entries.filter((e) => e.date === date).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
}

/** The days of this month that hold at least one Google event ("YYYY-MM-DD"). */
export function datesWithEvents(year: number, month: number): Set<string> {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  return new Set(entries.filter((e) => e.date.startsWith(prefix)).map((e) => e.date));
}

/** How many Google events today holds (the head meta and the tab dot). */
export function todayCount(now = new Date()): number {
  const k = dayKey(now);
  return entries.filter((e) => e.date === k).length;
}

/** The local "YYYY-MM-DD" of a day (calendar.ts's own key). */
function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Asks the Rust side for the feed, at most once per staleness window. The
 * page calls this on every build; the guard and the window keep it cheap. */
export async function refresh(force = false): Promise<void> {
  if (busy) return;
  if (!force && Date.now() - lastAttempt < STALE_MS) return;
  lastAttempt = Date.now();
  busy = true;
  try {
    isPresent = await Bridge.secretPresent("gcal-ics-url");
    if (!isPresent) {
      if (entries.length || fetchedAt) {
        entries = [];
        fetchedAt = 0;
        lastError = null;
        changed();
      }
      return;
    }
    const got = await Bridge.icsFetch();
    entries = got;
    fetchedAt = Date.now();
    lastError = null;
    changed();
  } catch (e) {
    lastError = String(e).replace(/^Error:\s*/, "") || "HTTP error";
    changed();
  } finally {
    busy = false;
  }
}
