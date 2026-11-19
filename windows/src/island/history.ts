// The record of notices that came and went (dev/notif-history-mockup.html):
// the notice card folds away after a few seconds, so the Notif page in the
// widget deck keeps what it said — a WhatsApp / LINE / Discord message, an
// agent that finished, a released update. Japanese and Korean text gets a
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
import { N_, t } from "../i18n/i18n";

export type NoticeKind = "chat" | "agent" | "sistem";

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

export type NoticeFilter = "all" | NoticeKind;

const KEY = "miku.notices.history";
const MAX = 100;
const FILTERS: readonly { id: NoticeFilter; name: string }[] = [
  { id: "all", name: N_("All") },
  { id: "chat", name: N_("Chats") },
  { id: "agent", name: N_("Agents") },
  { id: "sistem", name: N_("System") },
];

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

/** What the page shows, newest first, already filtered. */
export function list(): NoticeEntry[] {
  return entries.filter((e) => filter === "all" || e.kind === filter);
}

export function getFilter(): NoticeFilter {
  return filter;
}

export function setFilter(f: NoticeFilter) {
  if (f === filter) return;
  filter = f;
  changes++;
}

/** The filter pills (All, Chats, Agents, System). */
export function filters(): readonly { id: NoticeFilter; name: string }[] {
  return FILTERS;
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

/** Marks one entry read; the page re-renders. */
export function markRead(id: number): void {
  const e = entries.find((x) => x.id === id);
  if (e && !e.read) {
    e.read = true;
    changes++;
    save();
    State.notify();
  }
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
