// Settings search in the Miku window: matches every setting of Flow,
// Notch and Mail in the app's language, whatever the accents and case.
// Port of SettingsSearch.swift and SettingsSearchMatch.swift.

import { t } from "../i18n/i18n";
import type { PageId } from "./shell";

export interface SettingsSearchEntry {
  /** The box's anchor, unique. */
  id: string;
  page: PageId;
  /** The box's title (catalog key, or a name that is never translated). */
  title: string;
  /** The labels inside the box (catalog keys). */
  terms: string[];
}

export interface SettingsSearchHit {
  entry: SettingsSearchEntry;
  label?: string;
  id: string;
}

export type MatchResult =
  | { kind: "box" }
  | { kind: "label"; label: string };

/**
 * Normalizes a string for searching: case-insensitive, diacritic/accent-insensitive,
 * trimmed of leading/trailing whitespace.
 */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * The words of a query, normalized.
 */
export function words(query: string): string[] {
  return query
    .split(/\s+/)
    .map(normalize)
    .filter((w) => w.length > 0);
}

/**
 * Matches a list of query words against a box's title, page and inner labels.
 * Returns null when the box doesn't have every word.
 */
export function match(
  wordList: string[],
  title: string,
  page: string,
  labels: string[]
): MatchResult | null {
  if (wordList.length === 0) return null;
  const head = normalize(title + " " + page);
  const texts = labels.map(normalize);
  const all = [head, ...texts].join(" ");
  if (!wordList.every((w) => all.includes(w))) return null;
  if (wordList.every((w) => head.includes(w))) return { kind: "box" };

  // The label with the most of the words, the first one when tied.
  let bestIndex = -1;
  let bestCount = 0;
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const count = wordList.filter((w) => text.includes(w)).length;
    if (count > 0 && count > bestCount) {
      bestIndex = i;
      bestCount = count;
    }
  }

  if (bestIndex < 0) return { kind: "box" };
  return { kind: "label", label: labels[bestIndex] };
}

// Every title and term below is the English text a page actually draws — the
// same string its controls pass to `t()` — not a macOS catalog key. This app's
// i18n table is keyed by English text, so a dotted key would be searched for
// literally and shown to the user as itself. When a control's label changes,
// change it here too: `tests/settings_search.test.mjs` checks that every entry
// matches at least one real page and that no title looks like a catalog key.
export const SETTINGS_ENTRIES: SettingsSearchEntry[] = [
  // ── Flow ────────────────────────────────────────────────────────────────────
  { id: "flow.history", page: "dictation", title: "History", terms: ["Dictation", "Search dictations", "Copy", "Delete"] },
  { id: "flow.notes", page: "notes", title: "The Notetaker", terms: ["Record a call", "Summary", "Transcript", "Key points", "To do", "Export as Markdown…"] },
  { id: "flow.insights", page: "insights", title: "Statistics", terms: ["Words dictated", "Time saved", "Speed", "Dictations", "Where you dictate"] },
  { id: "flow.dictionary", page: "dictionary", title: "Dictionary", terms: ["Add a word, e.g. Supabase", "Replacements", "Heard, e.g. cloud code"] },
  { id: "flow.snippets", page: "snippets", title: "Snippets", terms: ["New snippet", "What you say, e.g. my signature", "The text Miku pastes"] },
  { id: "flow.styles", page: "styles", title: "Styles", terms: ["Clean up with Claude", "Style per app", "Other apps", "As said", "Natural", "Polished"] },
  {
    id: "flow.keys",
    page: "flowsettings",
    title: "Keys",
    terms: [
      "Hold a key to dictate anywhere", "Hold to dictate", "A shortcut of your own…",
      "Where the pill is", "Hands-free", "Paste the last dictation again", "Cancel a dictation",
    ],
  },
  { id: "flow.microphone", page: "flowsettings", title: "Microphone", terms: ["System default", "Mute the computer while you speak"] },
  { id: "flow.recognition", page: "flowsettings", title: "Recognition", terms: ["Parakeet, on your computer", "Download", "Remove the models"] },
  { id: "flow.summary", page: "flowsettings", title: "Summaries", terms: ["Notetaker", "Claude (your key)", "No summary"] },
  { id: "flow.app", page: "flowsettings", title: "App", terms: ["Open this window when you open Miku", "Not when Miku starts with the computer."] },
  { id: "flow.privacy", page: "flowsettings", title: "Privacy", terms: ["Keep the history", "Erase the history", "Erase everything", "Don't keep", "Forever"] },

  // ── Notch → General ─────────────────────────────────────────────────────────
  { id: "general.sound", page: "general", title: "Sound", terms: ["Open sounds folder", "Reload sounds", "Volume"] },
  { id: "general.behavior", page: "general", title: "Open on hover", terms: ["Open for every pill’s alerts", "Show clock in the island", "Auto-close", "seconds after you leave the island"] },
  { id: "general.display", page: "general", title: "Closed island shows", terms: ["Island lives on", "Main display", "Display under the cursor", "Hide the island"] },
  { id: "general.startup", page: "general", title: "Launch at startup", terms: ["Startup"] },
  { id: "general.update", page: "general", title: "Updates", terms: ["Tell me when a new version is out", "Check now", "Install {version}", "Get {version} on GitHub"] },
  { id: "general.recap", page: "general", title: "Weekly recap", terms: ["Keep a history of my coding sessions", "Clear history"] },
  { id: "general.lyrics", page: "general", title: "Floating lyrics", terms: ["Placement", "In the top pill", "Floating", "Romanise the lyrics", "Show lyrics for videos too", "Show the words as written", "Opacity", "Text size", "Width", "Height", "Text colour", "Card colour"] },
  { id: "general.language", page: "general", title: "Language", terms: ["System"] },

  // ── Notch → the rest ────────────────────────────────────────────────────────
  { id: "pills.main", page: "pills", title: "Active pills", terms: ["Main tool", "Main", "Color", "Active"] },
  { id: "agents.claude", page: "agents", title: "Claude Code", terms: ["Install hooks…", "Reinstall hooks…", "Uninstall hooks…"] },
  { id: "agents.others", page: "agents", title: "Agents", terms: ["Codex", "GitHub Copilot", "Muse Code", "Gemini", "Antigravity", "Cursor", "OpenCode", "Amp", "Hermes", "ZCode", "Install…", "Uninstall…"] },
  { id: "agents.plan", page: "agents", title: "Plan usage", terms: ["Show in notch", "Show in compact island", "Show Codex plan in the notch", "Relay", "Install relay…", "Uninstall relay…"] },
  { id: "chat.subscriptions", page: "chat", title: "Your AI subscriptions", terms: ["Your AI subscriptions", "Claude", "Gemini", "ChatGPT", "Cursor", "Copilot", "Install it"] },
  { id: "chat.anthropic", page: "chat", title: "Claude", terms: ["API key", "Save key", "Remove", "Model", "Refresh", "Anthropic"] },
  { id: "chat.others", page: "chat", title: "Chat providers", terms: ["Google AI", "OpenAI", "OpenRouter", "Key from {site}"] },
  { id: "chat.local", page: "chat", title: "Local models", terms: ["Ollama", "LM Studio", "Connect", "Disconnect", "Use in chat", "API key (optional)"] },
  {
    id: "integrations.all",
    page: "integrations",
    title: "Integrations",
    terms: [
      "Stripe", "GitHub", "GitLab", "Gitea", "Vercel", "n8n", "Resend", "Notion", "Cal.com", "Music", "Spotify",
      "System", "CPU", "RAM", "Battery", "WhatsApp", "Save", "Remove",
    ],
  },
  {
    id: "integrations.whatsapp",
    page: "integrations",
    title: "WhatsApp",
    terms: ["Install WhatsApp", "Mute groups (unless I’m mentioned)", "Mark as read when I open a conversation", "Ignored chats", "Advanced: your own gateway"],
  },
  {
    id: "phone.android",
    page: "phone",
    title: "Android phone",
    terms: [
      "Phone link", "Show pairing code", "Pair again", "Copy link",
      "Show session details on the phone", "Let the phone answer Claude Code's questions",
      "Show the files an agent changed on the phone", "Show my plan usage on the phone",
      "Show my weekly recap on the phone", "Show these services on the phone",
      "Let the phone chat with my AI providers",
    ],
  },
  { id: "voice.wake", page: "voice", title: "Listening", terms: ["Listen for « OK Miku »", "Parakeet, on your computer"] },
  { id: "voice.tts", page: "voice", title: "Answers", terms: ["System voice", "ElevenLabs", "Text only", "Female", "Male", "ElevenLabs key"] },
  { id: "shortcuts.global", page: "shortcuts", title: "From anywhere", terms: ["Toggle the island", "Open the chat", "Go to the alert", "Jump to the terminal", "Next pill", "Previous pill", "Mute", "Show Mochi on the desktop", "Wardrobe", "Reset to defaults"] },
  { id: "shortcuts.island", page: "shortcuts", title: "In the open island", terms: ["In the open island"] },

  // ── Mail (Windows only) ─────────────────────────────────────────────────────
  { id: "mail.autosort", page: "mailOverview", title: "Sort new messages automatically", terms: ["Journal", "Sent by Miku", "Clear", "Undo", "sorted today", "sent to Junk", "marked important"] },
  { id: "mail.rules", page: "mailRules", title: "Rules", terms: ["If", "Then", "Sender", "Sender’s domain", "Subject", "Text", "Account", "Move to Junk", "Mark important", "Mark as read", "Move to mailbox…"] },
  { id: "mail.banned", page: "mailBanned", title: "Banned words", terms: ["A word, a phrase or an address"] },
  { id: "mail.vip", page: "mailVIP", title: "VIP", terms: ["paul@client.com or @client.com"] },
];

/**
 * Searches the settings index given a query string and page title resolver.
 */
export function searchSettings(
  query: string,
  getPageTitle: (page: PageId) => string,
  entries: SettingsSearchEntry[] = SETTINGS_ENTRIES
): SettingsSearchHit[] {
  const qWords = words(query);
  if (qWords.length === 0) return [];
  const boxes: SettingsSearchHit[] = [];
  const labels: SettingsSearchHit[] = [];

  for (const entry of entries) {
    const titleText = t(entry.title);
    const pageText = getPageTitle(entry.page);
    const labelTexts = entry.terms.map((k) => t(k));
    const res = match(qWords, titleText, pageText, labelTexts);
    if (!res) continue;
    if (res.kind === "box") {
      boxes.push({ entry, id: entry.id });
    } else {
      labels.push({ entry, label: res.label, id: `${entry.id}|${res.label}` });
    }
  }

  return [...boxes, ...labels].slice(0, 30);
}
