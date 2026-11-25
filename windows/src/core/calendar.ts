// The calendar's events (the Calendar page in the widget deck): dates the user
// marked, each with a title and an optional time. Nothing here talks to any
// service — these are this computer's own notes about days ahead.
//
// Storage: localStorage of the island's own window, like the notice history —
// nothing leaves this computer, and the past is kept only for a year.

import { State } from "../core/state";

/** One thing to remember on a day. */
export interface CalendarEntry {
  id: number;
  /** "YYYY-MM-DD", the local day it belongs to. */
  date: string;
  /** "HH:mm", when it matters during that day — optional. */
  time?: string;
  title: string;
}

const KEY = "miku.calendar.events";
/** Past events are kept for a year, then quietly dropped. */
const KEEP_MS = 365 * 24 * 60 * 60_000;

let nextId = 1;
let entries: CalendarEntry[] = load();
/** Rises at every change of what the Calendar page draws: the deck's page key
 * reads this instead of stringifying the whole list on every sync. */
let changes = 0;

/** How many times the events changed (deck pageKey). */
export function version(): number {
  return changes;
}

function load(): CalendarEntry[] {
  try {
    const raw = window.localStorage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const list = (parsed as CalendarEntry[]).filter(
      (e) => e && typeof e.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.title === "string",
    );
    nextId = list.reduce((m, e) => Math.max(m, e.id ?? 0), 0) + 1;
    return list;
  } catch {
    return [];
  }
}

function save() {
  try {
    window.localStorage?.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Full or blocked storage: the events just stay in memory.
  }
}

function changed() {
  changes++;
  save();
  State.notify();
}

/** The local "YYYY-MM-DD" of a day. */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Every event, date order, time order inside a day. */
export function list(): CalendarEntry[] {
  return [...entries].sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")) || a.id - b.id);
}

/** The day's events, in order. */
export function of(date: string): CalendarEntry[] {
  return list().filter((e) => e.date === date);
}

/** The days of this month that hold at least one event ("YYYY-MM-DD" keys). */
export function datesWithEvents(year: number, month: number): Set<string> {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  return new Set(entries.filter((e) => e.date.startsWith(prefix)).map((e) => e.date));
}

/** How many events today holds — the dot on the deck's tab. */
export function todayCount(now = new Date()): number {
  return of(dayKey(now)).length;
}

/** Notes something down on a day. */
export function add(n: { date: string; time?: string; title: string }): void {
  const title = n.title.trim();
  if (!title) return;
  const time = n.time?.trim() || undefined;
  entries.push({ id: nextId++, date: n.date, time, title });
  changed();
}

/** Takes these events off the calendar. */
export function remove(ids: readonly number[]): void {
  const before = entries.length;
  entries = entries.filter((e) => !ids.includes(e.id));
  if (entries.length === before) return;
  changed();
}

/** Clears every event older than a year, keeping the memory tidy. */
export function prune(now = new Date()): void {
  const keep = now.getTime() - KEEP_MS;
  const before = entries.length;
  entries = entries.filter((e) => {
    const d = new Date(`${e.date}T${e.time ?? "00:00"}`);
    return Number.isNaN(d.getTime()) || d.getTime() >= keep;
  });
  if (entries.length !== before) changed();
}

/** How the page names the month, e.g. "November 2026". */
export function monthTitle(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** The page's weekday initials, Monday first — "M T W T F S S". */
export function weekdayLetters(): string[] {
  // The week starts on Monday: a Monday-based offset puts each day's own
  // short name under its column. (2024 started on a Monday.)
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }),
  );
}
