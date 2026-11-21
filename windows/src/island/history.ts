// The record of notices that came and went (dev/notif-history-mockup.html):
// the notice card folds away after a few seconds, so the Notif page in the
// widget deck keeps what it said — a WhatsApp / LINE / Discord message, an
// agent that finished, a released update, any other PC app's toast. Japanese and Korean text gets a
// romaji line, as the notice card and the lyrics do.
//
// Storage: localStorage of the island's own window — nothing leaves this
// computer, and the newest 100 are kept.

import { State } from "../core/state";
import {
  ensureJapaneseTokenizer,
  languageOfLines,
  romanizeMixed,
  scriptOf,
} from "../lyrics/romanize";
import { t } from "../i18n/i18n";

/** "pc": any other app's toast (pc_notifications.rs), shown and kept, never opened. */
export type NoticeKind = "chat" | "agent" | "sistem" | "pc";

export interface NoticeEntry {
  id: number;
  at: number;
  kind: NoticeKind;
  /** whatsapp | line | discord | the agent's task id | miku — decides the click. */
  app: string;
  color: string;
  /** The source's name as the notice card shows it (untranslated: LINE, Discord…). */
  label: string;
  /** The contact, the channel, or the step an agent finished. */
  who: string;
  text: string;
  /** The text in letters to read, when it is not Latin. */
  rom?: string;
  /** Where the app said its toast leads — a chat to open, when it wrote one. */
  target?: string;
  read: boolean;
}

/** "all", or one source (sourceOf): the page filters by who sent it, not by kind. */
export type NoticeFilter = string;

const KEY = "miku.notices.history";
const MAX = 100;

let nextId = 1;
let entries: NoticeEntry[] = load();
let filter: NoticeFilter = "all";
let clearing = false; // the clear button waits for a second click
/** Rises at every change of what the Notif page draws: the deck's page key
 * reads this instead of stringifying the whole history on every sync. */
let changes = 0;

/** How many times the history has changed (deck pageKey). */
export function version(): number {
  return changes;
}

function load(): NoticeEntry[] {
  try {
    const raw = window.localStorage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const list = parsed as NoticeEntry[];
    nextId = list.reduce((m, e) => Math.max(m, e.id ?? 0), 0) + 1;
    return list.filter((e) => e && typeof e.at === "number");
  } catch {
    return [];
  }
}

function save() {
  try {
    window.localStorage?.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Full or blocked storage: the history just stays in memory.
  }
}

/** How many came in and were not seen yet — the dot on the deck's tab. */
export function unreadCount(): number {
  return entries.filter((e) => !e.read).length;
}

export function unreadOf(app: string): number {
  return entries.filter((e) => e.app === app && !e.read).length;
}

/** The source an entry counts under on the page's chips: the chat app, the
 * agent, or the PC app by its name (every PC toast has app "pc"). */
export function sourceOf(e: NoticeEntry): string {
  return e.kind === "pc" || e.kind === "agent" ? `${e.kind}:${e.label}` : e.app;
}

/** One chip per source that sent something, newest first, with its count. */
export function sources(): { id: string; label: string; color: string; count: number }[] {
  const out = new Map<string, { id: string; label: string; color: string; count: number }>();
  for (const e of entries) {
    const id = sourceOf(e);
    const s = out.get(id);
    if (s) s.count++;
    else out.set(id, { id, label: e.label, color: e.color, count: 1 });
  }
  return [...out.values()];
}

/** What the page shows, newest first, already filtered. A source that is
 * gone (cleared, removed) falls back to all. */
export function list(): NoticeEntry[] {
  const shown = entries.filter((e) => filter === "all" || sourceOf(e) === filter);
  return shown.length || filter === "all" ? shown : entries;
}

/** Entries in a row from one sender, in one day group, fold into one stack. */
export function stacks(list: readonly NoticeEntry[], now = new Date()): NoticeEntry[][] {
  const out: NoticeEntry[][] = [];
  for (const e of list) {
    const prev = out.at(-1)?.[0];
    if (prev && sourceOf(prev) === sourceOf(e) && prev.who === e.who && groupOf(prev.at, now) === groupOf(e.at, now)) out.at(-1)!.push(e);
    else out.push([e]);
  }
  return out;
}

/** Only a chat or an agent leads somewhere; any other app's toast is just shown. */
export function opens(e: NoticeEntry): boolean {
  return e.kind === "agent" || e.app === "line" || e.app === "discord";
}

export function getFilter(): NoticeFilter {
  return filter;
}

export function setFilter(f: NoticeFilter) {
  if (f === filter) return;
  filter = f;
  changes++;
}

/** The clear button armed for the second click. */
export function isClearing(): boolean {
  return clearing;
}

export function armClear(): void {
  clearing = true;
  changes++;
}

/** The second click (or leaving the page) actually clears. */
export function clear(): void {
  entries = [];
  clearing = false;
  changes++;
  save();
  State.notify();
}

export function disarmClear(): void {
  if (!clearing) return;
  clearing = false;
  changes++;
}

/** These entries read (a stack, or the whole page). */
export function markRead(ids: readonly number[]): void {
  let changed = false;
  for (const e of entries) {
    if (ids.includes(e.id) && !e.read) {
      e.read = true;
      changed = true;
    }
  }
  if (changed) {
    changes++;
    save();
    State.notify();
  }
}

/** Takes these entries off the page. */
export function remove(ids: readonly number[]): void {
  const before = entries.length;
  entries = entries.filter((e) => !ids.includes(e.id));
  if (entries.length === before) return;
  changes++;
  save();
  State.notify();
}

/** A whole source was seen (its notice card said "Mark as read"). */
export function markAppRead(app: string): void {
  let changed = false;
  for (const e of entries) {
    if (e.app === app && !e.read) {
      e.read = true;
      changed = true;
    }
  }
  if (changed) {
    changes++;
    save();
    State.notify();
  }
}

/**
 * Records a notice. The romaji line follows State.settings.noticeRomanize,
 * like the notice card does.
 */
export async function add(n: {
  kind: NoticeKind;
  app: string;
  color: string;
  label: string;
  who: string;
  text: string;
  target?: string;
}): Promise<void> {
  let rom = "";
  if (State.settings.noticeRomanize !== false && scriptOf(n.text) !== "latin") {
    const lang = languageOfLines([n.text]);
    if (lang === "japanese") await ensureJapaneseTokenizer();
    rom = romanizeMixed(n.text, lang, State.settings.lyricsRomajiLangs);
    if (rom === n.text) rom = "";
  }
  const entry: NoticeEntry = { id: nextId++, at: Date.now(), read: false, rom: rom || undefined, ...n };
  entries.unshift(entry);
  if (entries.length > MAX) entries.length = MAX;
  changes++;
  save();
  State.notify();
}

/** "14:02", "Yesterday 21:10", "Mon 10:02" — as the entry shows it. */
export function timeOf(at: number, now = new Date()): string {
  const d = new Date(at);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const hm = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay(d, now)) return hm;
  if (sameDay(d, yesterday)) return `${t("Yesterday")} ${hm}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${hm}`;
}

/** The group a time falls in: today, yesterday, earlier. */
export function groupOf(at: number, now = new Date()): "today" | "yesterday" | "earlier" {
  const d = new Date(at);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, now)) return "today";
  if (sameDay(d, yesterday)) return "yesterday";
  return "earlier";
}
