import test from "node:test";
import assert from "node:assert/strict";
import { normalize, words, match, searchSettings, SETTINGS_ENTRIES } from "../src/hub/search.ts";

test("SettingsSearch - words normalization and splitting", () => {
  assert.deepEqual(words("  Réglage   SON "), ["reglage", "son"]);
  assert.deepEqual(words("   "), []);
  assert.deepEqual(words("général"), ["general"]);
  assert.deepEqual(words("Türkçe Ayarlar"), ["turkce", "ayarlar"]);
  assert.deepEqual(words("Häufige Fragen"), ["haufige", "fragen"]);
});

test("SettingsSearch - match against box, title, and labels (Mac contract parity)", () => {
  const sound = {
    title: "Son",
    page: "Général",
    labels: ["Activer les sons", "Volume", "Ouvrir le dossier des sons"],
  };

  const m = (q) => match(words(q), sound.title, sound.page, sound.labels);

  // The box by its title or its page, whatever the accents and the case.
  assert.deepEqual(m("son"), { kind: "box" });
  assert.deepEqual(m("GENERAL"), { kind: "box" });
  assert.deepEqual(m("général son"), { kind: "box" });

  // A setting inside it.
  assert.deepEqual(m("volu"), { kind: "label", label: "Volume" });
  assert.deepEqual(m("dossier"), { kind: "label", label: "Ouvrir le dossier des sons" });

  // Every word somewhere; the label with most of them.
  assert.deepEqual(m("ouvrir dossier son"), { kind: "label", label: "Ouvrir le dossier des sons" });
  assert.deepEqual(m("volume general"), { kind: "label", label: "Volume" });

  // Not there.
  assert.equal(m("micro"), null);
  assert.equal(m("volume micro"), null, "every word must be found");
  assert.equal(m(""), null);
});

test("SettingsSearch - searchSettings searches entries across Flow, Notch and Mail", () => {
  const pageTitles = {
    dictation: "Dictation",
    flowsettings: "Settings",
    general: "General",
    agents: "Agents",
    mailOverview: "Overview",
    mailRules: "Rules",
    mailBanned: "Banned words",
    mailVIP: "VIP",
  };
  const getPageTitle = (p) => pageTitles[p] ?? p;

  // Search by box name
  const resKeys = searchSettings("keys", getPageTitle);
  assert.ok(resKeys.length > 0);
  assert.ok(resKeys.some((h) => h.entry.id === "flow.keys"));

  // Search by a label inside the box: the words the page actually draws. The
  // page spells it "Hands-free", so that is what a search for it must find.
  const resHandsfree = searchSettings("hands-free", getPageTitle);
  assert.ok(resHandsfree.length > 0);
  assert.ok(resHandsfree.some((h) => h.entry.id === "flow.keys"));

  // Search by sound in general
  const resSound = searchSettings("sound", getPageTitle);
  assert.ok(resSound.some((h) => h.entry.id === "general.sound"));

  // Search Mail entries
  const resMail = searchSettings("rules", getPageTitle);
  assert.ok(resMail.some((h) => h.entry.id === "mail.rules"));

  const resBanned = searchSettings("banned", getPageTitle);
  assert.ok(resBanned.some((h) => h.entry.id === "mail.banned"));

  // Empty query returns empty array
  assert.deepEqual(searchSettings("", getPageTitle), []);
  assert.deepEqual(searchSettings("   ", getPageTitle), []);

  // Unknown query returns empty array
  assert.deepEqual(searchSettings("nonexistentgibberishqueryxyz", getPageTitle), []);
});

test("SettingsSearch - SETTINGS_ENTRIES integrity and completeness", () => {
  assert.ok(SETTINGS_ENTRIES.length >= 30, "must include complete set of hub settings");
  const ids = new Set();
  for (const entry of SETTINGS_ENTRIES) {
    assert.ok(entry.id, "every entry must have an id");
    assert.ok(!ids.has(entry.id), `duplicate entry id: ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.page, `entry ${entry.id} must define a page`);
    assert.ok(entry.title, `entry ${entry.id} must define a title`);
    assert.ok(Array.isArray(entry.terms), `entry ${entry.id} must define terms array`);
  }
});

// The bug this guards against: the index once held macOS catalog keys
// ("hub.mail.autosort", "vitals.title"), which this app's i18n table does not
// know, so results rendered as literal dotted text and pointed at controls that
// no longer existed.
test("no entry is a macOS catalog key this app cannot translate", () => {
  // A catalog key is dotted, lowercase, and has no capital letter anywhere —
  // which is what tells "hub.mail.autosort" from a product name like "Cal.com".
  const catalogKey = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;
  const offenders = [];
  for (const entry of SETTINGS_ENTRIES) {
    if (catalogKey.test(entry.title)) offenders.push(`${entry.id}: title "${entry.title}"`);
    for (const term of entry.terms) {
      if (catalogKey.test(term)) offenders.push(`${entry.id}: term "${term}"`);
    }
  }
  assert.deepEqual(offenders, [], `catalog keys in the index:\n${offenders.join("\n")}`);
});

// Every page the sidebar can show must be reachable from search, or someone who
// searches for it gets nothing and has to find the page by hand. The pages that
// became tabs of another page are reached through their host (the island's
// settings through "notch", the old Dictionary id through "words"), so what is
// checked here is the sidebar's own rows.
test("every hub page has at least one search entry", () => {
  const pages = [
    "dictation", "notes", "words", "styles", "settingsView",
    "notch", "pills", "agents", "chat", "voice", "shortcuts",
    "mailOverview", "mailRules", "mailBanned", "mailVIP",
  ];
  const covered = new Set(SETTINGS_ENTRIES.map((e) => e.page));
  const missing = pages.filter((p) => !covered.has(p));
  assert.deepEqual(missing, [], `pages with no search entry: ${missing.join(", ")}`);
});

// A real user searches for the words on screen. Each entry must be found by its
// own title, so a control renamed on the page but not here fails the suite.
test("every entry is found by its own title", () => {
  const getPageTitle = (p) => p;
  for (const entry of SETTINGS_ENTRIES) {
    const hits = searchSettings(entry.title, getPageTitle);
    assert.ok(
      hits.some((h) => h.entry.id === entry.id),
      `"${entry.title}" (${entry.id}) is not found by searching for its own title`,
    );
  }
});

// Clicking a search hit scrolls to `[data-anchor="<id>"]` and glows it
// (hub/shell.ts). A hit whose anchor is not in the page source just jumps to the
// top with no glow, which is what every Notch page used to do.
test("every search entry has its anchor in the page source", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join } = await import("node:path");

  const sources = [];
  for (const root of ["src/settings", "src/hub/pages"]) {
    const dir = fileURLToPath(new URL(`../${root}/`, import.meta.url));
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".ts")) sources.push(readFileSync(join(dir, file), "utf8"));
    }
  }
  sources.push(readFileSync(fileURLToPath(new URL("../src/hub/shell.ts", import.meta.url)), "utf8"));
  const all = sources.join("\n");

  const missing = SETTINGS_ENTRIES
    .map((e) => e.id)
    // A page marks the box either with the helper — anchor("id", el) — or by
    // setting el.dataset.anchor = "id" directly. The Banned and VIP pages share
    // one builder and choose between the two ids with a ternary, so those two
    // appear as a quoted string inside it rather than as a whole assignment.
    .filter((id) => !(
      all.includes(`anchor("${id}"`)
      || all.includes(`.dataset.anchor = "${id}"`)
      || all.includes(`"${id}" : `)
      || all.includes(`: "${id}"`)
    ));
  assert.deepEqual(missing, [], `search entries with no anchor on their page: ${missing.join(", ")}`);
});
