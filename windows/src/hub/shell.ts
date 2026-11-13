// The Miku window: a sidebar with Flow (dictation, the Notetaker, the
// statistics, the dictionary, the snippets, the styles and their settings)
// and Notch (every setting of the island), and the page on the right, under
// its coloured band. Port of FlowHub.swift.

import "./hub.css";
import { h, clear } from "../views/dom";
import { t, tl, onLanguageChange } from "../i18n/i18n";
import { onEvent } from "../core/bridge";
import { FlowBridge, type FlowPrefs, type FlowStatus, type ModelsStatus, flowKeyId } from "../core/flow";
import { hero, liveMochi, setVoiceLevel, setWindowShown } from "./hero";
import { characterGreet, setStagePolling, setStageState, watchMusic, type StageState } from "./character";
import { icon, keyLabel } from "./ui";
import { searchSettings, type SettingsSearchHit } from "./search";
import { mainMenu } from "./menu";

/**
 * Everything a page can be: the sections the sidebar lists, and the tabs a
 * section draws. Existing ids never go away, so an anchor, a `hub-page` event
 * from the backend, or a saved shortcut keeps working.
 */
export type PageId =
  | "home" | "wardrobe"
  | "dictation" | "notes" | "styles" | "words" | "settingsView" | "islandSettings"
  | "notch" | "mail"
  // Drawn as tabs of a section, still addressable on their own.
  | "insights" | "dictionary" | "snippets" | "flowsettings"
  | "general" | "pills" | "agents" | "chat" | "voice" | "shortcuts"
  | "mailOverview" | "mailRules" | "mailBanned" | "mailVIP";

/** One tab inside a page: the sidebar lists the page, its band lists these. */
export interface PageTab {
  /** The page id the tab draws, so an anchor and a deep link keep working. */
  id: PageId;
  title: () => string;
}

interface PageDef {
  id: PageId;
  icon: string;
  title: () => string;
  /** The band's line; none for pages that draw their own band. */
  subtitle?: () => string;
  /**
   * The page's own tabs, drawn under its band. The sidebar shows one row for
   * the page: the sections that are opened rarely (the island's settings, the
   * mail rules) read better as tabs than as five rows each in a list someone
   * has to scan every time.
   */
  tabs?: () => PageTab[];
}

const NOTCH_TABS: PageTab[] = [
  { id: "general", title: () => t("General") },
  { id: "pills", title: () => t("Active pills") },
  { id: "agents", title: () => t("Agents") },
  { id: "chat", title: () => t("Chat") },
  { id: "voice", title: () => "OK Miku" },
  { id: "shortcuts", title: () => t("Shortcuts") },
];

const MAIL_TABS: PageTab[] = [
  { id: "mailOverview", title: () => t("Overview") },
  { id: "mailRules", title: () => t("Rules") },
  { id: "mailBanned", title: () => t("Banned words") },
  { id: "mailVIP", title: () => t("VIP") },
];

const SETTINGS_TABS: PageTab[] = [
  { id: "flowsettings", title: () => t("Dictation") },
  // Not "general": that id is one of the island's tabs, and an id belongs to
  // one section only. This one draws the same settings from this page.
  { id: "islandSettings", title: () => t("The island") },
];

export const FLOW_PAGES: PageDef[] = [
  { id: "wardrobe", icon: "star", title: () => t("Wardrobe") },
  { id: "dictation", icon: "mic", title: () => t("Dictation") },
  // The notes and what Miku counted while you dictated: one page, so the
  // numbers sit next to the words they come from.
  { id: "notes", icon: "record", title: () => t("Notetaker") },
  // Dictionary and Snippets: both are about the words Miku keeps for you.
  { id: "words", icon: "book", title: () => t("Words") },
  { id: "styles", icon: "text", title: () => t("Styles") },
  // The flow's own settings and the island's: one page, two tabs. Two sidebar
  // rows called "Settings" and "General" was the confusing part.
  {
    id: "settingsView", icon: "sliders", title: () => t("Settings"),
    subtitle: () => t("Dictation, the island and how Miku behaves."),
    tabs: () => SETTINGS_TABS,
  },
];

/**
 * The island's settings: one sidebar row, its five sections as tabs under the
 * band. Opened rarely, and five rows in the list made everything else harder
 * to find.
 */
export const NOTCH_PAGE: PageDef = {
  id: "notch", icon: "gear", title: () => t("The island"),
  subtitle: () => t("The pills, the agents, the chat and the keys."),
  tabs: () => NOTCH_TABS,
};

/** Mail (classic Outlook): Windows only, Linux has no Outlook. */
export const MAIL_PAGE: PageDef = {
  id: "mail", icon: "tray", title: () => t("Mail"),
  subtitle: () => t("What Miku tells you about your inbox."),
  tabs: () => MAIL_TABS,
};

/** The landing page: what Miku is doing, one card per thing. */
export const HOME_PAGE: PageDef = { id: "home", icon: "grid", title: () => t("Home") };

/** The sections the sidebar lists, in the order it lists them. */
export const SIDE_PAGES: PageDef[] = [HOME_PAGE, ...FLOW_PAGES];

/**
 * Every page a tab can draw, so anchors, search and deep links keep a
 * `PageId` to point at. `SIDE_PAGES` is what the sidebar lists.
 */
const ALL_TABS = [HOME_PAGE, ...FLOW_PAGES, NOTCH_PAGE, MAIL_PAGE];
const DRAWN: PageDef[] = [
  ...ALL_TABS,
  ...NOTCH_TABS.map((tab) => ({ id: tab.id, icon: NOTCH_PAGE.icon, title: tab.title })),
  ...MAIL_TABS.map((tab) => ({ id: tab.id, icon: MAIL_PAGE.icon, title: tab.title })),
];

/**
 * Where an old id now lives. Dictionary and Snippets became sections of Words,
 * and Statistics a section of the Notetaker: those ids stay valid for search
 * entries and deep links, they just draw their host page.
 */
const MOVED: Partial<Record<PageId, PageId>> = {
  dictionary: "words",
  snippets: "words",
  insights: "notes",
};

/** The section and tab a page id belongs to. */
export function sectionOf(page: PageId): { section: PageDef; tab: PageTab | null } {
  const id = MOVED[page] ?? page;
  for (const section of ALL_TABS) {
    const tabs = section.tabs?.() ?? [];
    const hit = tabs.find((tab) => tab.id === id);
    if (hit) return { section, tab: hit };
    if (section.id === id) return { section, tab: null };
  }
  return { section: HOME_PAGE, tab: null };
}

/** What a page gets to draw itself and reach the rest of the window. */
export interface HubContext {
  status: FlowStatus;
  navigate(page: PageId): void;
  /** Reads the status again (prefs, models) and redraws the sidebar's line. */
  refresh(): Promise<FlowStatus>;
  /** Saves new preferences and keeps them as the window's. */
  setPrefs(change: (p: FlowPrefs) => void): Promise<void>;
  /** The band of a page, its Mochis walking. */
  hero(page: PageId, title: string, subtitle: string | null, actions?: HTMLElement[], compact?: boolean): HTMLElement;
  /** Draws the island's own settings (Settings → the island tab). */
  renderIslandSettings(container: HTMLElement): Promise<void>;
  /** Set by a page: called when the page is left. */
  onLeave?: () => void;
}

export type FlowPageRenderer = (container: HTMLElement, ctx: HubContext) => void | Promise<void>;

export interface HubOptions {
  version: string;
  flowPages: Partial<Record<PageId, FlowPageRenderer>>;
  /** Draws the island's settings for one of the Notch pages into `container`. */
  renderNotch(page: PageId, container: HTMLElement): Promise<void>;
}

const DEFAULT_STATUS: FlowStatus = {
  prefs: {
    enabled: false, key: "right_ctrl", keyCombo: [], edge: "bottom", mic: "", keepDays: 30, cleanup: false,
    defaultStyle: "natural", summaryEngine: "claude", openAtLaunch: true, voice: false, voiceOutput: "system", voiceGender: "female", muteOthers: true,
  },
  models: { parakeet: { state: "missing" }, downloadMb: 700 },
  keys: "ok",
  hasClaudeKey: false,
  mics: [],
  platform: navigator.userAgent.includes("Windows") ? "windows" : "linux",
  autostarted: false,
};

export async function startHub(root: HTMLElement, opts: HubOptions) {
  document.body.classList.add("hub-window");
  // The window is created hidden and only shown and hidden afterwards: its
  // canvases animate only while it is on screen (#792), and the character
  // stage polls the agents' state only while it is.
  await onEvent<boolean>("hub-visible", (shown) => {
    setWindowShown(shown);
    setStagePolling(shown);
  });
  // While you dictate: the loudest of the pill's bands.
  await onEvent<number[]>("flow-bands", (bands) => setVoiceLevel(Math.max(0, ...bands)));
  const shown = await FlowBridge.hubShown();
  if (shown !== null) {
    setWindowShown(shown);
    setStagePolling(shown);
    // The event above can race its listener: a hub shown before the page
    // finished loading emits into the void, and the page then paints dead
    // canvases. A slow re-ask stands in — `setWindowShown` only acts when the
    // answer changes. (Only under Tauri: outside it the answer is always
    // null, and the timer would hold a test process open for nothing.)
    let shownSynced = shown;
    const resync = window.setInterval(() => {
      void FlowBridge.hubShown().then((now) => {
        if (now !== null && now !== shownSynced) {
          shownSynced = now;
          setWindowShown(now);
          setStagePolling(now);
        }
      });
    }, 5000);
    (resync as unknown as { unref?: () => void }).unref?.();
  }
  let current: PageId = "home";
  let activeAnchor: string | null = null;
  let searchHits: SettingsSearchHit[] = [];
  let status: FlowStatus = (await FlowBridge.status()) ?? DEFAULT_STATUS;
  const items = new Map<PageId, HTMLElement>();
  const labels = new Map<PageId, HTMLElement>();
  const searchRows = new Map<string, HTMLElement>();
  const statusLine = h("div", { class: "hub-status" });
  const scroll = h("div", { class: "hub-scroll" });
  let rendering = 0;

  const ctx: HubContext = {
    get status() {
      return status;
    },
    navigate: (page) => void show(page),
    refresh: async () => {
      status = (await FlowBridge.status()) ?? status;
      drawStatus();
      return status;
    },
    setPrefs: async (change) => {
      const next = { ...status.prefs };
      change(next);
      status = { ...status, prefs: next };
      drawStatus();
      await FlowBridge.setPrefs(next);
    },
    hero: (page, title, subtitle, actions = [], compact = false) => hero(page, title, subtitle, actions, compact),
    renderIslandSettings: (container) => opts.renderNotch("islandSettings", container),
  };

  function drawStatus() {
    clear(statusLine);
    const models = status.models.parakeet.state;
    let color = "#6b7079";
    let text: string;
    if (!status.prefs.enabled) {
      text = t("Dictation is off");
    } else if (models !== "ready") {
      color = "#f7b32b";
      text = models === "downloading" ? t("Downloading the voice model…") : t("Download the voice model to dictate");
    } else if (status.keys !== "ok" && status.keys !== "wayland") {
      color = "#f7b32b";
      text = t("Use the pill's microphone to dictate");
    } else {
      color = "#34d399";
      text = t("Ready · hold {0}", { 0: keyLabel(status.keys === "wayland" ? "wayland" : flowKeyId(status.prefs), status.platform) });
    }
    const dot = h("i", { class: "dot" });
    dot.style.background = color;
    dot.style.color = color;
    // A ripple while the voice model downloads: the chip is doing something.
    if (models === "downloading" && status.prefs.enabled) dot.classList.add("pulse");
    statusLine.append(dot, h("span", { text }));
  }

  function updateSearchRowHighlights() {
    for (const [id, rowEl] of searchRows) {
      rowEl.classList.toggle("on", id === activeAnchor);
    }
  }

  async function show(page: PageId, targetAnchor?: string) {
    // A page id names either a section or one of its tabs; the sidebar lights
    // the section either way, and the band belongs to the section.
    const { section, tab } = sectionOf(page);
    const def = tab ? { id: tab.id, icon: section.icon, title: tab.title } : section;
    ctx.onLeave?.();
    ctx.onLeave = undefined;
    current = def.id;
    activeAnchor = targetAnchor ?? null;
    // `items` maps every id a row answers to (the section and each of its
    // tabs) onto that one row, so comparing the section id finds it.
    for (const [id, el] of items) {
      el.classList.toggle("on", sectionOf(id).section.id === section.id);
    }
    updateSearchRowHighlights();
    const token = ++rendering;
    const page_ = h("div", { class: "hub-page" });
    // A page that merges tabs reads this to open the one a search hit named.
    page_.dataset.openTab = page;
    // A section id draws its first tab; a tab id draws itself.
    const sectionTabs = section.tabs?.() ?? [];
    const shownTab = tab ?? sectionTabs[0] ?? null;
    const drawId = shownTab?.id ?? section.id;
    const renderer = opts.flowPages[drawId];
    if (renderer && sectionTabs.length === 0) {
      await renderer(page_, ctx);
    } else {
      // The section's own band, then its tabs: the page inside is one of them.
      page_.append(hero(section.id, section.title(), section.subtitle?.() ?? null));
      if (sectionTabs.length > 0) {
        const tabRow = h("div", { class: "hub-tabs" });
        // What a search for the page itself lands on. The band is the page.
        if (section.id === "notch") tabRow.dataset.anchor = "notch.all";
        if (section.id === "mail") tabRow.dataset.anchor = "mail.all";
        page_.append(tabRow);
        for (const t2 of sectionTabs) {
          const b = h("button", {
            class: t2.id === drawId ? "hub-tab on" : "hub-tab",
            text: t2.title(),
          });
          b.addEventListener("click", () => void show(t2.id));
          tabRow.append(b);
        }
      }
      const container = h("div", { id: "settings-root" });
      page_.append(container);
      await opts.renderNotch(drawId, container);
    }
    if (token !== rendering) return;
    clear(scroll);
    scroll.append(page_);
    // She greets the page that just arrived: the band's stage is new, and the
    // brand and any stage still on screen wave with it.
    characterGreet();
    if (targetAnchor) {
      const el = page_.querySelector(`[data-anchor="${targetAnchor}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("hub-card-glowing");
        void el.offsetWidth;
        el.classList.add("hub-card-glowing");
      } else {
        scroll.scrollTop = 0;
      }
    } else {
      scroll.scrollTop = 0;
    }
  }

  // ── The sidebar ──
  const side = h("nav", { class: "hub-side" });
  const logo = h("canvas", {});
  side.append(h("div", { class: "hub-brand" },
    logo,
    h("span", { class: "hub-brand-name" },
      h("b", { text: "Miku" }),
      h("small", { text: tl("Settings") }),
    ),
  ));
  liveMochi(logo as HTMLCanvasElement);

  // Settings search field
  const searchInput = h("input", {
    class: "hub-search-input",
    type: "text",
    placeholder: t("Search settings"),
    spellcheck: "false",
  }) as HTMLInputElement;

  const searchClear = h("button", {
    class: "hub-search-clear",
    title: t("Close"),
    style: "display:none",
  }, icon("x"));

  const searchBox = h("div", { class: "hub-search" },
    icon("search"),
    searchInput,
    searchClear,
  );
  searchBox.querySelector("svg")?.classList.add("hub-search-icon");

  const groupsContainer = h("div", { class: "hub-groups" });
  const resultsContainer = h("div", { class: "hub-search-results", style: "display:none" });

  // Home sits above the groups: the window opens on it.
  const homeButton = h("button", { class: "hub-item hub-item-home", onclick: () => void show("home") });
  const homeLabel = h("span", { text: HOME_PAGE.title() });
  homeButton.append(icon(HOME_PAGE.icon), homeLabel);
  items.set("home", homeButton);
  labels.set("home", homeLabel);
  groupsContainer.append(homeButton);


  /**
   * One row per section. A section whose sections are tabs (the island, Mail)
   * is a single row here, and the tab it last showed is the one it opens on:
   * coming back to "The island" should not always land on General.
   */
  const group = (title: string, pages: PageDef[]) => {
    const heading = h("div", { class: "hub-group", text: title });
    groupsContainer.append(heading);
    for (const p of pages) {
      const tabs = p.tabs?.() ?? [];
      const first = tabs[0]?.id ?? p.id;
      const last = new Map<PageId, PageId>();
      const b = h("button", {
        class: "hub-item",
        onclick: () => void show(last.get(p.id) ?? first),
      });
      const label = h("span", { text: p.title() });
      b.append(icon(p.icon), label);
      items.set(p.id, b);
      labels.set(p.id, label);
      for (const tab of tabs) last.set(tab.id as PageId, tab.id);
      groupsContainer.append(b);
      // Remember the tab this section was last on, from any tab it draws.
      for (const tab of tabs) {
        items.set(tab.id, b);
        labels.set(tab.id, label);
      }
    }
    return heading;
  };
  group("Flow", FLOW_PAGES);
  const notchGroup = group(t("Notch"), [NOTCH_PAGE]);
  if (status.platform === "windows") group("Mail", [MAIL_PAGE]);

  function renderSearchResults() {
    clear(resultsContainer);
    searchRows.clear();
    const query = searchInput.value.trim();
    if (!query) {
      searchClear.style.display = "none";
      resultsContainer.style.display = "none";
      searchHits = [];
      return;
    }
    searchClear.style.display = "";
    resultsContainer.style.display = "";
    searchHits = searchSettings(query, (pageId) => DRAWN.find((p) => p.id === pageId)?.title() ?? pageId);
    if (searchHits.length === 0) {
      resultsContainer.append(h("div", { class: "hub-search-empty", text: t("No setting found") }));
      return;
    }
    for (const hit of searchHits) {
      const pageDef = DRAWN.find((p) => p.id === hit.entry.page);
      const row = h("button", { class: "hub-search-row" });
      if (activeAnchor === hit.entry.id && current === hit.entry.page) {
        row.classList.add("on");
      }
      row.append(icon(pageDef?.icon ?? "sliders"));
      const textContainer = h("div", { class: "hub-search-row-text" });
      const rowTitle = h("div", { class: "hub-search-row-title", text: hit.label ?? t(hit.entry.title) });
      const rowSubtitle = h("div", {
        class: "hub-search-row-subtitle",
        text: hit.label
          ? `${pageDef?.title() ?? ""} › ${t(hit.entry.title)}`
          : (pageDef?.title() ?? ""),
      });
      textContainer.append(rowTitle, rowSubtitle);
      row.append(textContainer);
      row.addEventListener("click", () => {
        void show(hit.entry.page, hit.entry.id);
      });
      searchRows.set(hit.entry.id, row);
      resultsContainer.append(row);
    }
  }

  searchInput.addEventListener("input", renderSearchResults);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchInput.value = "";
      renderSearchResults();
    } else if (e.key === "Enter") {
      if (searchHits.length > 0) {
        void show(searchHits[0].entry.page, searchHits[0].entry.id);
      }
    }
  });

  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    renderSearchResults();
    searchInput.focus();
  });

  onLanguageChange(() => {
    searchInput.placeholder = t("Search settings");
    if (searchInput.value.trim()) renderSearchResults();
  });

  side.append(h("div", { class: "spacer" }), statusLine, h("div", { class: "hub-version", text: `Miku ${opts.version}` }));

  // The window opens on the main menu; a bubble (or a deep link) opens the pages.
  const menu = mainMenu(
    [HOME_PAGE, ...FLOW_PAGES, NOTCH_PAGE, ...(status.platform === "windows" ? [MAIL_PAGE] : [])],
    (page) => void show(page),
  );

  // The panel's top bar: back to the menu, and every section as a chip (the
  // sidebar keeps her, the search and the status).
  const topbar = h("div", { class: "hub-topbar" },
    menu.back,
    groupsContainer,
    h("div", { class: "hub-topbar-search" }, searchBox, resultsContainer),
  );

  clear(root);
  root.append(menu.bg, side, h("main", { class: "hub-panel" }, topbar, scroll), menu.el);
  drawStatus();
  await show(current);

  void onEvent<string>("hub-page", (page) => {
    const id = (page === "settings" ? "flowsettings" : page) as PageId;
    if (!DRAWN.some((p) => p.id === id)) return;
    void show(id);
    menu.open();
  });
  // What the agents are up to, announced by the backend as soon as it changes
  // (stage.rs); the stage's poll only covers what an announcement missed.
  void onEvent<StageState>("hub-stage", (state) => setStageState(state));
  // The player, for the stage's dance: the island's own event, plus a snapshot
  // so a window opened during a song starts dancing at once.
  watchMusic();
  void onEvent<FlowPrefs>("flow-prefs", (prefs) => {
    status = { ...status, prefs };
    drawStatus();
  });
  void onEvent<ModelsStatus>("speech-models", (models) => {
    status = { ...status, models };
    drawStatus();
  });
  return {
    redraw: () => {
      // The sidebar's own rows first: `DRAWN` holds the tabs, which share the
      // section's row and its label.
      for (const p of SIDE_PAGES) {
        const label = labels.get(p.id);
        if (label) label.textContent = p.title();
      }
      for (const p of [NOTCH_PAGE, MAIL_PAGE]) {
        const label = labels.get(p.id);
        if (label) label.textContent = p.title();
      }
      notchGroup.textContent = t("Notch");
      menu.relabel();
      drawStatus();
      void show(current);
    },
    current: () => current,
  };
}
