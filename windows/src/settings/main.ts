// The Miku window (settings.html): Flow dictation, the Notetaker and, under
// Notch, every setting of the island — the place where anything that writes to
// disk is confirmed. The window's frame and the Flow pages live in ../hub; the
// island's settings are drawn here, one Notch page at a time.

import "./settings.css";
import { ensureJapaneseTokenizer, languageOfLines, romanizeMixed } from "../lyrics/romanize";
import { Bridge, onEvent, type HookPreview, type HookStatus, type ShortcutsReport, type SubscriptionStatus } from "../core/bridge";
import { CUSTOM_SERVER_KEY, providerDef, urlExposure } from "../core/providers";
import {
  ISLAND_SHORTCUTS, SHORTCUTS, SHORTCUT_TEXT, activeKeys, displayKeys, duplicates, effective,
  recordPress, type Binding,
} from "../core/shortcuts";
import { DEFAULT_SETTINGS, State, type Settings } from "../core/state";
import {
  ageLabel, codexResetsLabel, effectivePct, planColor, resetLabel,
  type CodexPlanUsage, type PlanUsage, type PlanWindow,
} from "../core/plan";
import { closedIsland } from "../core/closed";
import type { UpdateStatus } from "../core/update";
import { SOUND_NAMES } from "../core/sound";
import {
  MAX_DECLARED, PILL_CATEGORIES, availablePills, chooseMainPill, isComingSoon, mainPillChoices,
  sanitizeDeclared, toggleDeclared, type PillDefinition,
} from "../core/pills";
import { h, clear } from "../views/dom";
import { startHub, type PageId } from "../hub/shell";
import { anchor } from "../hub/ui";
import { watchSkin } from "../theme/sync";
import { FLOW_PAGE_RENDERERS } from "../hub/pages";
import { claudeModelControl } from "./claude-models";
import { agentsSection } from "./agents";
import { approvalsSection } from "./approvals";
import { whatsappSection } from "./whatsapp";
import { WHATSAPP_ID } from "../core/whatsapp";
import { updateRows, updatesListener } from "./updates";
import { colorDot } from "./colors";
import { fold, moreLabel, renderDiff, statusDot } from "./parts";
import {
  LANGUAGES, N_, isRtl, onLanguageChange, resolveLanguage, setLanguage, systemLanguages, t, tn,
} from "../i18n/i18n";

/** Where secrets.rs keeps the keys on this OS. */
const KEY_STORE = navigator.userAgent.includes("Windows")
  ? "Windows Credential Manager"
  : "Secret Service (GNOME Keyring, KWallet)";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";
/** Which credentials the pills page found in the key store, read once per draw. */
let presentKeys: Record<string, boolean> = {};

const windowRoot = document.getElementById("hub")!;
/** Where the Notch page being shown draws its sections. */
let root: HTMLElement = windowRoot;
let hub: { redraw(): void; current(): PageId } | null = null;

async function save() {
  // The hub's own Miku (hub/hero.ts) follows State, as the island's does:
  // keep that copy in step before the window that owns the settings hears it.
  State.settings = settings;
  await Bridge.saveSettings(settings);
}

/** A colour was picked for a pill's Mochi (see ./colors.ts): the island follows. */
function pickColor(next: Record<string, string>) {
  settings.pillColors = next;
  void save();
}

// ── Reusable bits ─────────────────────────────────────────────────────────────

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
  return el;
}

// ── Changes to Claude Code's settings.json ────────────────────────────────────

/** One kind of change to ~/.claude/settings.json, with the words that go with it. */
interface Change {
  preview: (install: boolean) => Promise<HookPreview | null>;
  apply: (install: boolean, fingerprint: string) => Promise<string | null>;
  installText: string;
  removeText: string;
  installButton: string;
  removeButton: string;
  /** The note once written; `backup` is "" when there was no file to back up. */
  done: (backup: string) => string;
}

const HOOKS_CHANGE: Change = {
  preview: Bridge.hooksPreview,
  apply: Bridge.hooksApply,
  get installText() { return t("This is exactly what will change in your settings.json. Your own hooks are left untouched."); },
  get removeText() { return t("This removes Miku's entries only. Your own hooks are left untouched."); },
  get installButton() { return t("Back up and write"); },
  get removeButton() { return t("Back up and remove"); },
  done: (backup) => backup
    ? t("Done. Previous settings saved as {backup}. Open a new Claude Code session to pick the hooks up.", { backup })
    : t("Done. Open a new Claude Code session to pick the hooks up."),
};

const STATUS_LINE_CHANGE: Change = {
  preview: Bridge.statusLinePreview,
  apply: Bridge.statusLineApply,
  get installText() { return t("This is exactly what will change: only the status line. If you already have one it keeps working, Miku's relay runs it for you."); },
  get removeText() { return t("This puts your previous status line back, or removes the entry if there was none."); },
  get installButton() { return t("Back up and write"); },
  get removeButton() { return t("Back up and remove"); },
  done: (backup) => backup
    ? t("Done. Previous settings saved as {backup}. The numbers appear after the next reply of a Claude Code session.", { backup })
    : t("Done. The numbers appear after the next reply of a Claude Code session."),
};

/**
 * Shows the diff of a change in `body` and writes it only after an explicit
 * click, and only if settings.json still matches the diff that was shown.
 * `back` redraws the section; `applied` runs a moment after a successful write.
 */
async function reviewChange(
  body: HTMLElement,
  change: Change,
  install: boolean,
  back: () => void,
  applied: () => void,
) {
  let preview;
  try {
    preview = await change.preview(install);
  } catch (err) {
    // An unreadable or invalid settings.json stops here rather than being
    // treated as empty and written over.
    clear(body);
    body.append(
      h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }),
      h("div", { class: "row" }, h("button", { text: t("Back"), onclick: back })),
    );
    return;
  }
  if (!preview) return;
  clear(body);
  body.append(
    h("div", { class: "hint", text: install ? change.installText : change.removeText }),
    renderDiff(preview.diff),
    h("div", { class: "row" },
      h("span", {
        class: "path",
        text: preview.backup
          ? t("Backup → {path}", { path: preview.backup })
          : t("No settings.json yet — nothing to back up."),
      }),
    ),
  );
  const confirm = h("button", {
    class: install ? "primary" : "danger",
    text: install ? change.installButton : change.removeButton,
  });
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    try {
      const backup = await change.apply(install, preview.fingerprint);
      clear(body);
      body.append(h("div", { class: "notice ok", text: change.done(backup ?? "") }));
      window.setTimeout(applied, 2600);
    } catch (err) {
      confirm.disabled = false;
      body.append(h("div", { class: "notice err", text: t("Could not write: {error}", { error: String(err) }) }));
    }
  });
  body.append(h("div", { class: "row" }, confirm, h("button", { text: t("Cancel"), onclick: back })));
}

// ── Claude Code section ───────────────────────────────────────────────────────

function claudeSection(status: HookStatus): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = anchor("agents.claude", h(
    "section",
    {},
    h("h2", {}, statusDot(status.installed), h("span", { text: "Claude Code" })),
    body,
  ));

  const redraw = () => {
    clear(body);
    draw();
  };
  const rebuild = async () => {
    const fresh = await Bridge.hooksStatus();
    if (fresh) Object.assign(status, fresh);
    redraw();
    const head = section.querySelector("h2")!;
    clear(head);
    head.append(statusDot(status.installed), h("span", { text: "Claude Code" }));
  };

  function draw() {
    body.append(
      h("div", {
        class: "hint",
        text: status.installed
          ? t("Miku is hooked into your Claude Code sessions. Tool calls, questions and permission requests show up in the island, and you can answer them there.")
          : t("Install the hooks to see your Claude Code sessions in the island and approve permissions without leaving what you are doing."),
      }),
      h("div", { class: "row" },
        h("label", { text: "settings.json" }),
        h("span", { class: "path", text: status.settingsPath }),
      ),
      h("div", { class: "row" },
        h("label", { text: t("Relay") }),
        h("span", { class: "path", text: status.hookPath }),
        statusDot(status.hookReady),
      ),
    );

    if (!status.hookReady) {
      body.append(h("div", {
        class: "notice warn",
        text: t("miku-hook.exe is not in place yet. Restart Miku; if it still fails, build it with `cargo build -p miku-hook`."),
      }));
    }

    const actions = h("div", { class: "row" });
    const install = h("button", {
      class: "primary",
      text: status.installed ? t("Reinstall hooks…") : t("Install hooks…"),
      onclick: () => void reviewChange(body, HOOKS_CHANGE, true, redraw, () => void rebuild()),
    });
    // Writing hook commands that point at a relay which isn't there would give
    // every Claude Code session a broken hook and nothing to show for it.
    if (!status.hookReady) {
      install.disabled = true;
      install.title = t("The relay isn't installed yet.");
    }
    actions.append(install);
    if (status.installed) {
      actions.append(h("button", {
        class: "danger",
        text: t("Uninstall hooks…"),
        onclick: () => void reviewChange(body, HOOKS_CHANGE, false, redraw, () => void rebuild()),
      }));
    }
    body.append(actions);
  }

  draw();
  return section;
}

// ── Plan usage section ────────────────────────────────────────────────────────

/**
 * One plan's numbers as a card: what is left, when it comes back, and the bar.
 * The line that matters is the reset — "resets in 1 h 20" is what decides
 * whether to start a long task now — so it is the main line and the percentage
 * supports it, not the other way round.
 */
function planCard(
  title: string,
  usage: PlanUsage | CodexPlanUsage | null,
  window: PlanWindow | null,
  weekly: boolean,
  extra: string | null,
): HTMLElement {
  const now = Date.now();
  const pct = window ? effectivePct(window, now) : null;
  const left = pct == null ? null : Math.max(0, Math.round(100 - pct));
  const head = h("div", { class: "plan-head" },
    h("span", { class: "plan-title", text: title }),
    h("span", { class: "plan-pct", text: left == null ? t("No data yet") : t("{left}% left", { left }) }),
  );
  const reset = window && pct != null
    ? t("Resets {when}", { when: resetLabel(window, weekly, now) })
    : t("Turn it on to see the numbers.");
  const bar = h("div", { class: "plan-bar" },
    h("i", {
      style: `width:${pct ?? 0}%;background:${planColor(pct)}`,
    }),
  );
  const card = h("div", { class: "plan-card" }, head, bar,
    h("div", { class: "plan-reset", text: reset }),
  );
  if (extra) card.append(h("div", { class: "hint", text: extra }));
  if (usage) card.append(h("div", { class: "hint", text: ageLabel(usage.updatedAt, now) }));
  return card;
}

/**
 * The 5-hour and weekly limits in the island's header. They come from Claude
 * Code's status line, so the relay has to be the status line first: turning the
 * switch on without it starts the install, and the switch only stays on once
 * that has been confirmed. A status line the user had keeps working.
 */
const PLAN_SETTINGS_TEXT = {
  get claude() { return t("Shows your Claude plan usage (5-hour and weekly limits) in the island's header. Miku adds a status line relay in ~/.claude/settings.json. If you already have a status line, it keeps working as before. Pro and Max plans only."); },
  get claudeCli() { return t("The numbers come from the Claude Code command-line tool. The Claude desktop app does not report them, so the gauge stays empty if you only use the desktop app."); },
  get showClaude() { return t("Show in notch"); },
  get showClaudeCompact() { return t("Show in compact island"); },
  get codex() { return t("Shows your Codex plan usage (weekly limit and free resets left) in the island's header. Miku asks the Codex CLI (codex app-server) when the pill shows; nothing is installed. Codex must be signed in with ChatGPT."); },
  get showCodex() { return t("Show Codex plan in the notch"); },
};

function planSection(status: HookStatus): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const cards = h("div", { class: "plan-cards" });
  const section = anchor("agents.plan", h("section", {}, h("h2", {}, h("span", { text: t("Plan usage") })), cards, body));

  /** The week outlasts the day: show the window that is closest to running out. */
  function tightest(u: PlanUsage | null): { window: PlanWindow | null; weekly: boolean } {
    if (!u) return { window: null, weekly: false };
    const week = u.sevenDay && u.sevenDay.resetsAt > Date.now() ? u.sevenDay : null;
    const five = u.fiveHour && u.fiveHour.resetsAt > Date.now() ? u.fiveHour : null;
    if (week && five) return week.usedPct >= five.usedPct ? { window: week, weekly: true } : { window: five, weekly: false };
    if (week) return { window: week, weekly: true };
    return { window: five, weekly: false };
  }

  function drawCards() {
    clear(cards);
    const claude = tightest(State.planUsage);
    cards.append(planCard("Claude", State.planUsage, claude.window, claude.weekly, null));
    const codex = tightest(State.codexPlanUsage);
    cards.append(planCard(
      "Codex", State.codexPlanUsage, codex.window, codex.weekly,
      codexResetsLabel(State.codexPlanUsage),
    ));
  }

  const redraw = () => {
    drawCards();
    clear(body);
    draw();
  };
  const rebuild = async () => {
    const fresh = await Bridge.hooksStatus();
    if (fresh) Object.assign(status, fresh);
    settings.planRelayInstalled = status.planRelayInstalled;
    // Cancelled or failed: a switch that was waiting for the install falls back.
    if (!status.planRelayInstalled) {
      settings.showPlanInNotch = false;
      settings.showPlanInCompactIsland = false;
    }
    redraw();
  };

  function draw() {
    // The switch shows "on" while the install it asked for is being reviewed.
    const sw = toggle(settings.showPlanInNotch, (on) => {
      if (!on) {
        settings.showPlanInNotch = false;
        void save();
      } else if (status.planRelayInstalled) {
        settings.showPlanInNotch = true;
        void save();
      } else {
        // Turned on before the relay is in: install it first; it stays on once confirmed.
        void reviewChange(body, STATUS_LINE_CHANGE, true, () => void rebuild(), () => {
          settings.planRelayInstalled = true;
          settings.showPlanInNotch = true;
          void save().then(rebuild);
        });
      }
    });
    const swCompact = toggle(settings.showPlanInCompactIsland, (on) => {
      if (!on) {
        settings.showPlanInCompactIsland = false;
        void save();
      } else if (status.planRelayInstalled) {
        settings.showPlanInCompactIsland = true;
        void save();
      } else {
        void reviewChange(body, STATUS_LINE_CHANGE, true, () => void rebuild(), () => {
          settings.planRelayInstalled = true;
          settings.showPlanInCompactIsland = true;
          void save().then(rebuild);
        });
      }
    });
    body.append(
      h("div", {
        class: "hint",
        text: PLAN_SETTINGS_TEXT.claude,
      }),
      h("div", { class: "hint", text: PLAN_SETTINGS_TEXT.claudeCli }),
      h("div", { class: "row" }, h("label", { text: PLAN_SETTINGS_TEXT.showClaude }), sw),
      h("div", { class: "row" }, h("label", { text: PLAN_SETTINGS_TEXT.showClaudeCompact }), swCompact),
      h("div", { class: "row" },
        h("label", { text: t("Relay") }),
        statusDot(status.planRelayInstalled),
        h("span", { class: "hint", text: status.planRelayInstalled ? t("installed") : t("not installed") }),
        status.planRelayInstalled
          ? h("button", {
              class: "danger",
              text: t("Uninstall relay…"),
              onclick: () => void reviewChange(body, STATUS_LINE_CHANGE, false, redraw, () => void rebuild()),
            })
          : h("button", {
              class: "primary",
              text: t("Install relay…"),
              onclick: () => void reviewChange(body, STATUS_LINE_CHANGE, true, redraw, () => void rebuild()),
            }),
      ),
      // Codex: nothing to install, Miku asks the Codex CLI when the pill shows.
      h("div", { class: "hint", text: PLAN_SETTINGS_TEXT.codex }),
      h("div", { class: "row" },
        h("label", { text: PLAN_SETTINGS_TEXT.showCodex }),
        toggle(settings.showCodexPlanInNotch, (on) => {
          settings.showCodexPlanInNotch = on;
          void save();
        }),
      ),
    );
  }

  // The cards first, then the switches under them: drawCards() used to be
  // called only from redraw(), so a page opened on its own had an empty strip.
  drawCards();
  draw();
  return section;
}

// ── Your AI subscriptions ─────────────────────────────────────────────────────

/** The plan people know, by provider. */
const SUBSCRIPTION_NAMES: Record<string, string> = {
  anthropic: "Claude", google: "Google Gemini", openai: "ChatGPT", cursor: "Cursor", copilot: "GitHub Copilot",
  zcode: "ZCode",
};

/**
 * One switch per provider (cli_relay.rs): on, the chat goes through its
 * official terminal tool, signed in with the user's own account; off, through
 * its API key. Says whether the tool is installed and how to sign in.
 */
function subscriptionsSection(): HTMLElement {
  const list = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const draw = (rows: SubscriptionStatus[]) => {
    clear(list);
    for (const row of rows) {
      const p = providerDef(row.provider);
      const sw = toggle(row.on, (on) => {
        void Bridge.subscriptionSet(row.provider, on).then((next) => {
          if (next) draw(next);
        });
      });
      const lines: HTMLElement[] = [];
      if (row.installed) {
        lines.push(h("div", { class: "hint", style: "color:#22c55e", text: t("{tool} found ✓", { tool: row.tool }) }));
        lines.push(h("div", {
          class: "hint",
          text: t("Not signed in yet? Run this once in a terminal: {command}", { command: row.signIn }),
        }));
      } else {
        lines.push(h("div", { class: "row" },
          h("span", { class: "hint", text: t("{tool} not found.", { tool: row.tool }) }),
          h("button", { text: t("Install it"), onclick: () => void Bridge.openUrl(row.installUrl) }),
        ));
      }
      if (!row.subscriptionOnly && !row.on) {
        lines.push(h("div", { class: "hint", text: t("Off: the chat uses your API key below.") }));
      }
      list.append(h("div", {},
        h("div", { class: "row" },
          h("i", { class: "dot", style: `background:${p.accent}` }),
          h("label", { text: SUBSCRIPTION_NAMES[row.provider] ?? p.name }),
          sw,
        ),
        ...lines,
      ));
    }
  };
  void Bridge.subscriptionStatus().then((rows) => draw(rows ?? []));
  return anchor("chat.subscriptions", h(
    "section",
    {},
    h("h2", { text: t("Your AI subscriptions") }),
    h("div", {
      class: "hint",
      text: t("Chat on the plan you already pay for. Miku asks your AI's official terminal tool, signed in with your own account: it never sees your password or your key."),
    }),
    list,
  ));
}

// ── Claude API section ────────────────────────────────────────────────────────

/** The state line under Claude: the key, else Claude Code (switched on above), else what is missing. */
function apiState(hasKey: boolean, relay: boolean): string {
  if (hasKey) return t("Key saved in the {store}.", { store: KEY_STORE });
  return relay
    ? t("No key: the chat can go through your Claude subscription above.")
    : t("No key yet — the chat needs one.");
}

function apiSection(hasKey: boolean, relay: boolean): HTMLElement {
  const dot = statusDot(hasKey || relay);
  const state = h("span", { class: "hint", text: apiState(hasKey, relay) });

  const field = h("input", {
    type: "password",
    placeholder: hasKey ? `••••••••••••  ${t("(stored)")}` : "sk-ant-...",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;

  const saveBtn = h("button", { class: "primary", text: t("Save key") });
  const clearBtn = h("button", { class: "danger", text: t("Remove") });
  const feedback = h("div", {});

  async function refresh() {
    const present = (await Bridge.secretPresent("anthropic-api-key")) ?? false;
    const ready = (await Bridge.claudeReady()) ?? false;
    dot.style.background = ready ? "#22c55e" : "#f4505e";
    state.textContent = apiState(present, ready && !present);
    field.placeholder = present ? `••••••••••••  ${t("(stored)")}` : "sk-ant-...";
    clearBtn.style.display = present ? "" : "none";
    void model.reload(present);
  }

  saveBtn.addEventListener("click", async () => {
    const value = field.value.trim();
    if (!value) return;
    clear(feedback);
    try {
      await Bridge.secretSet("anthropic-api-key", value);
      field.value = "";
      feedback.append(h("div", { class: "notice ok", text: t("Saved. It never touches disk.") }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: t("Could not save: {error}", { error: String(err) }) }));
    }
  });

  clearBtn.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.secretClear("anthropic-api-key");
      feedback.append(h("div", { class: "notice ok", text: t("Key removed.") }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: t("Could not remove: {error}", { error: String(err) }) }));
    }
  });

  const model = claudeModelControl(() => settings.model, async (value) => {
    await Bridge.saveSettings({ ...settings, model: value });
    settings.model = value;
  });
  void model.reload(hasKey);

  clearBtn.style.display = hasKey ? "" : "none";

  return anchor("chat.anthropic", h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "Claude" })),
    state,
    h("div", { class: "row" }, h("label", { text: t("API key") }), field, saveBtn, clearBtn),
    model.element,
    feedback,
  ));
}

// ── Active pills section ──────────────────────────────────────────────────────

/**
 * The pills the island shows, one row each: the main workspace tool (always on,
 * no slot) and whatever else the user picks, with the credentials that row
 * needs on the same line.
 *
 * This page used to be two — Active pills for the agents, Integrations for the
 * services and their keys — with one slot pool shared between them, so the
 * pills page had to explain "Also in use: GitHub — turn one off in Integrations
 * to free a slot". One row, one switch and its key says the same thing without
 * the cross-reference.
 *
 * Rows in use are drawn; the rest sit under one fold, still on the page.
 */
function pillsSection(connected: Record<string, boolean>): HTMLElement {
  const slots = h("div", { class: "hint" });
  const holders = h("div", { class: "hint" });
  const main = h("select", {}) as HTMLSelectElement;
  for (const def of mainPillChoices()) main.append(h("option", { value: def.id, text: def.name }));
  main.addEventListener("change", () => {
    const next = chooseMainPill(settings, main.value);
    if (!next) return;
    settings.mainPill = next.mainPill;
    settings.activeIntegrations = next.activeIntegrations;
    declaredChanged();
  });

  const used = h("div", { class: "pill-group" });
  const rest = h("div", { class: "pill-group" });
  const restWrap = h("div");

  /** Why a pill would show nothing yet, as on the Mac's row. */
  function hint(def: PillDefinition): string | null {
    if (isComingSoon(def.id)) return t("Coming soon");
    if (def.connect.kind === "hooks" && !connected[def.id]) return t("Hooks not installed");
    if (def.connect.kind === "key" && !connected[def.id]) return t("Key not configured");
    if (def.connect.kind === "server" && !settings[def.connect.field]) return t("Not connected");
    return null;
  }

  /** The credentials a service's row carries; none for the others. */
  function credentials(def: PillDefinition): HTMLElement[] {
    const def2 = INTEGRATIONS.find((d) => d.id === def.id);
    if (!def2) return [];
    const rows = h("div", { style: "display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0" });
    for (const field of def2.fields) {
      const input = h("input", {
        type: field.secret ? "password" : "text",
        placeholder: presentKeys[field.key] ? CHAT_STRINGS.stored : field.placeholder,
        autocomplete: "off",
        spellcheck: "false",
        style: "flex:1 1 auto;min-width:0",
      }) as HTMLInputElement;
      const saveBtn = h("button", { text: t("Save") });
      const dotEl = statusDot(presentKeys[field.key] ?? false);
      // An empty Save used to erase the stored credential with no warning, so
      // one mis-click wiped the key. An empty field now only offers to remove
      // it, and that removal is a second click that says what it does.
      let confirming = false;
      const unconfirm = () => {
        if (!confirming) return;
        confirming = false;
        saveBtn.textContent = t("Save");
        saveBtn.classList.remove("danger");
      };
      input.addEventListener("input", unconfirm);
      saveBtn.addEventListener("click", async () => {
        const value = input.value.trim();
        if (!value && presentKeys[field.key]) {
          if (!confirming) {
            confirming = true;
            saveBtn.textContent = t("Remove");
            saveBtn.classList.add("danger");
            return;
          }
          confirming = false;
          saveBtn.textContent = t("Save");
          saveBtn.classList.remove("danger");
        }
        try {
          await Bridge.secretSet(field.key, value);
          presentKeys[field.key] = value.length > 0;
          input.value = "";
          input.placeholder = value ? CHAT_STRINGS.stored : field.placeholder;
          dotEl.style.background = value ? "#22c55e" : "#f4505e";
        } catch {
          dotEl.style.background = "#f5a524";
        }
      });
      rows.append(h("div", { class: "row" },
        h("label", { style: "min-width:104px", text: t(field.label) }),
        input, saveBtn, dotEl,
      ));
    }
    if (def2.hint) rows.append(h("div", { class: "hint", text: t(def2.hint) }));
    if (def.id === "integration_spotify") {
      // As on the Mac's row: said only when there is no Spotify to launch.
      const note = h("div", { class: "hint", style: "padding-top:5px" });
      rows.append(note);
      void Bridge.spotifyInstalled().then((ok) => {
        note.textContent = ok === false ? t("Not installed") : "";
      });
    }
    return [rows];
  }

  function row(def: PillDefinition): HTMLElement {
    const isMain = def.id === settings.mainPill;
    const on = settings.activeIntegrations.includes(def.id);
    const full = !isMain && !on && settings.activeIntegrations.length >= MAX_ACTIVE;
    const head = h("div", { class: full ? "pill-row full" : "pill-row" },
      colorDot(def, "width:10px;height:10px", () => settings.pillColors, pickColor),
      h("span", { class: "name", text: def.name }),
    );
    if (isMain) {
      head.append(h("span", { class: "state", text: t("Main") }));
      const keys = credentials(def);
      return keys.length === 0
        ? head
        : h("div", { style: "display:flex;gap:12px;align-items:flex-start" }, head, ...keys);
    }
    const why = hint(def);
    head.append(h("span", { class: "state", text: why ?? "" }));
    const sw = h("button", { class: on ? "switch on" : "switch" }) as HTMLButtonElement;
    sw.addEventListener("click", () => {
      // Full: say why, and where to make room, instead of a switch that does
      // nothing.
      if (!on && settings.activeIntegrations.length >= MAX_ACTIVE) {
        slots.textContent = t("All {max} slots are in use. Turn one off to make room for {name}.", { max: MAX_ACTIVE, name: def.name });
        slots.classList.add("hub-warn");
        return;
      }
      const next = toggleDeclared(settings, def.id);
      if (!next) return;
      settings.activeIntegrations = next;
      declaredChanged();
    });
    head.append(sw);
    const keys = on || isMain ? credentials(def) : [];
    return keys.length === 0
      ? head
      : h("div", { style: "display:flex;gap:12px;align-items:flex-start" }, head, ...keys);
  }

  function draw() {
    const count = settings.activeIntegrations.length;
    slots.classList.remove("hub-warn");
    slots.textContent = t("{used}/{max} slots in use — the main tool doesn't take one.", { used: count, max: MAX_ACTIVE });
    slots.classList.toggle("full", count >= MAX_ACTIVE);
    // Nothing to ask the other page for: the services sit on this page too.
    holders.textContent = "";
    main.value = settings.mainPill;

    clear(used);
    clear(rest);
    // In use first, in catalog order; the rest under the fold, by category.
    const all = availablePills().filter((p) => p.category !== "ai");
    for (const def of all) {
      if (def.id === settings.mainPill || settings.activeIntegrations.includes(def.id)) used.append(row(def));
    }
    for (const cat of PILL_CATEGORIES) {
      if (cat.id === "ai") continue;
      const folded = all
        .filter((p) => p.category === cat.id)
        .filter((p) => p.id !== settings.mainPill && !settings.activeIntegrations.includes(p.id));
      if (folded.length === 0) continue;
      rest.append(h("h3", { text: t(cat.title) }), ...folded.map(row));
    }
    clear(restWrap);
    if (rest.children.length > 0) restWrap.append(fold([rest], moreLabel));
  }

  declaredViews.push(draw);
  draw();

  return anchor("pills.main", h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Active pills") })),
    h("div", { class: "hint", text: t("Choose the tools you use. Miku only shows what you declare here. They follow the catalog order.") }),
    slots,
    holders,
    h("div", { class: "row" }, h("label", { text: t("Main tool") }), main),
    anchor("integrations.all", used),
    restWrap,
  ));
}

// ── Chat providers section ────────────────────────────────────────────────────

const CHAT_STRINGS = {
  get providersTitle() { return t("Chat providers"); },
  get providersHint() { return t("Chat with Google AI, OpenAI or OpenRouter instead of Claude: add a key here, then click the model name above the chat box to switch provider and model. Keys stay in the system keychain. These providers get no web search and no tools: they can answer, never act on this computer."); },
  get stored() { return `••••••••  ${t("(stored)")}`; },
  get save() { return t("Save"); },
  get remove() { return t("Remove"); },
  get localTitle() { return t("Local models"); },
  get localHint() { return t("Chat with a model you run yourself: Ollama or LM Studio (leave the address empty for the usual one on this computer), or any server that speaks the OpenAI API, such as vLLM or llama.cpp. Once connected, pick it above the chat box."); },
  get connect() { return t("Connect"); },
  get connecting() { return t("Connecting…"); },
  get disconnect() { return t("Disconnect"); },
  get useInChat() { return t("Use in chat"); },
  get inUse() { return t("In use"); },
  get keyOptional() { return t("API key (optional)"); },
  get localOnly() { return t("Nothing leaves your PC: the server runs on this computer."); },
  get remote() { return t("This address is another machine: what you ask is sent to it."); },
  get remoteHttp() { return t("This address is another machine, over plain http: what you ask travels unencrypted."); },
  get keyOverHttp() { return t("Warning: the key would be sent unencrypted (http://) to another machine. Use https://, or a server on this computer."); },
  get invalid() { return t("Not a valid http:// or https:// address."); },
  noModels: (name: string) => t("No models yet. Download one in {name} first.", { name }),
  models: (n: number) => tn("{count} model", "{count} models", n),
};

interface CloudDef {
  id: "google" | "openai" | "openrouter";
  name: string;
  placeholder: string;
  where: string;
}

const CLOUD: CloudDef[] = [
  { id: "google", name: "Google AI", placeholder: "AIza…", where: "aistudio.google.com" },
  { id: "openai", name: "OpenAI", placeholder: "sk-…", where: "platform.openai.com" },
  { id: "openrouter", name: "OpenRouter", placeholder: "sk-or-…", where: "openrouter.ai/keys" },
];

function chatProvidersSection(
  present: Record<string, boolean>,
  keyChanged: (key: string, on: boolean) => void,
): HTMLElement {
  const list = h("div", { style: "display:flex;flex-direction:column;gap:6px" });
  for (const def of CLOUD) {
    const p = providerDef(def.id);
    const key = p.key!;
    const input = h("input", {
      type: "password",
      placeholder: present[key] ? CHAT_STRINGS.stored : def.placeholder,
      autocomplete: "off",
      spellcheck: "false",
      style: "flex:1 1 auto;min-width:0",
    }) as HTMLInputElement;
    const dotEl = statusDot(present[key] ?? false);
    const saveBtn = h("button", { text: CHAT_STRINGS.save });
    const removeBtn = h("button", { class: "danger", text: CHAT_STRINGS.remove });
    // The key editor stays closed until it is asked for: three password fields
    // always open is what made this page read as a form rather than a list.
    const editor = h("div", { class: "key-editor" },
      h("div", { class: "row" }, input, saveBtn, removeBtn, dotEl),
      h("div", { class: "hint", text: t("Key from {site}", { site: def.where }) }),
    );
    const status = h("span", { class: "row-state" });
    const openBtn = h("button", { class: "link-btn", type: "button" });

    const refresh = () => {
      input.placeholder = present[key] ? CHAT_STRINGS.stored : def.placeholder;
      dotEl.style.background = present[key] ? "#22c55e" : "#f4505e";
      removeBtn.style.display = present[key] ? "" : "none";
      status.textContent = present[key] ? t("Key saved") : t("No key");
      openBtn.textContent = present[key] ? t("Replace key…") : t("Add key…");
      editor.hidden = true;
      openBtn.setAttribute("aria-expanded", "false");
    };
    openBtn.addEventListener("click", () => {
      const open = editor.hidden;
      editor.hidden = !open;
      openBtn.setAttribute("aria-expanded", String(open));
      if (open) input.focus();
    });
    saveBtn.addEventListener("click", async () => {
      const value = input.value.trim();
      if (!value) return;
      try {
        await Bridge.secretSet(key, value);
        present[key] = true;
        input.value = "";
        keyChanged(key, true);
      } catch {
        dotEl.style.background = "#f5a524";
        return;
      }
      refresh();
    });
    removeBtn.addEventListener("click", async () => {
      try {
        await Bridge.secretClear(key);
        present[key] = false;
        keyChanged(key, false);
      } catch {
        dotEl.style.background = "#f5a524";
        return;
      }
      refresh();
    });
    refresh();
    list.append(
      h("div", { style: "display:flex;flex-direction:column;gap:6px" },
        h("div", { class: "row" },
          h("label", { style: "min-width:104px" },
            h("i", { class: "dot", style: `background:${p.accent};margin-right:8px` }),
            h("span", { text: def.name }),
          ),
          status,
          h("span", { class: "spacer" }),
          openBtn,
        ),
        editor,
      ),
    );
  }
  return anchor("chat.others", h(
    "section",
    {},
    h("h2", {}, h("span", { text: CHAT_STRINGS.providersTitle })),
    h("div", { class: "hint", text: CHAT_STRINGS.providersHint }),
    list,
  ));
}

// ── Local models section ──────────────────────────────────────────────────────

type LocalId = "ollama" | "lmstudio" | "custom";

/** Redraws the local models section after a change made elsewhere (the island). */
let localRedraw: (() => void) | null = null;

const LOCAL: Record<LocalId, { name: string; usual: string }> = {
  ollama: { name: "Ollama", usual: "http://127.0.0.1:11434" },
  lmstudio: { name: "LM Studio", usual: "http://127.0.0.1:1234" },
  // No usual address: any server that speaks the OpenAI API.
  custom: { name: N_("OpenAI-compatible"), usual: "" },
};

/** What an address means for the user's data, as a hint line. */
function exposureNotice(url: string, withKey: boolean): HTMLElement | null {
  switch (urlExposure(url)) {
    case "local":
      return h("div", { class: "hint", text: CHAT_STRINGS.localOnly });
    case "remote":
      return h("div", { class: "hint", text: CHAT_STRINGS.remote });
    case "remote-http":
      return withKey
        ? h("div", { class: "notice warn", text: CHAT_STRINGS.keyOverHttp })
        : h("div", { class: "hint", text: CHAT_STRINGS.remoteHttp });
    case "invalid":
      return url.trim() ? h("div", { class: "notice err", text: CHAT_STRINGS.invalid }) : null;
  }
}

function localSection(customKey: boolean): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:14px" });
  const section = anchor("chat.local", h(
    "section",
    {},
    h("h2", {}, h("span", { text: CHAT_STRINGS.localTitle })),
    h("div", { class: "hint", text: CHAT_STRINGS.localHint }),
    body,
  ));
  const redraw = () => {
    clear(body);
    for (const id of Object.keys(LOCAL) as LocalId[]) body.append(serverBlock(id));
  };

  function serverBlock(id: LocalId): HTMLElement {
    const def = LOCAL[id];
    const p = providerDef(id);
    const field = p.urlField!;
    const connected = settings[field] !== "";
    const status = h("div", {});
    const exposure = h("div", {});
    const label = h("label", {},
      h("i", { class: "dot", style: `background:${p.accent};margin-right:8px` }),
      h("span", { text: t(def.name) }),
    );
    const block = h("div", { style: "display:flex;flex-direction:column;gap:6px" });

    if (connected) {
      const inUse = settings.chatProvider === id;
      const use = h("button", { class: inUse ? "" : "primary", text: inUse ? CHAT_STRINGS.inUse : CHAT_STRINGS.useInChat });
      use.disabled = inUse;
      use.addEventListener("click", () => {
        settings.chatProvider = id;
        void save().then(redraw);
      });
      const disconnect = h("button", { class: "danger", text: CHAT_STRINGS.disconnect });
      disconnect.addEventListener("click", async () => {
        settings[field] = "";
        if (settings.chatProvider === id) settings.chatProvider = "anthropic";
        if (id === "custom") {
          await Bridge.secretClear(CUSTOM_SERVER_KEY).catch(() => {});
          customKey = false;
        }
        await save();
        redraw();
      });
      block.append(
        h("div", { class: "row" }, label, h("span", { class: "path", text: settings[field] }), statusDot(true), use, disconnect),
        status,
      );
      exposure.append(exposureNotice(settings[field], id === "custom" && customKey) ?? "");
      block.append(exposure);
      return block;
    }

    const input = h("input", {
      type: "text",
      placeholder: def.usual || "https://llm.example.com",
      style: "flex:1 1 auto;min-width:0",
      spellcheck: "false",
      autocomplete: "off",
    }) as HTMLInputElement;
    // A custom server may want a key; it goes to the keychain, never to settings.json.
    const key = h("input", {
      type: "password",
      placeholder: customKey ? CHAT_STRINGS.stored : CHAT_STRINGS.keyOptional,
      style: "flex:1 1 auto;min-width:0",
      autocomplete: "off",
      spellcheck: "false",
    }) as HTMLInputElement;
    const connect = h("button", { class: "primary", text: CHAT_STRINGS.connect });

    const showExposure = () => {
      clear(exposure);
      const withKey = id === "custom" && (customKey || key.value.trim() !== "");
      const notice = exposureNotice(input.value || def.usual, withKey);
      if (notice) exposure.append(notice);
    };
    input.addEventListener("input", showExposure);
    key.addEventListener("input", showExposure);

    connect.addEventListener("click", async () => {
      connect.disabled = true;
      clear(status);
      status.append(h("div", { class: "hint", text: CHAT_STRINGS.connecting }));
      try {
        if (id === "custom" && key.value.trim()) {
          // Stored with this address: the key is only ever sent there.
          await Bridge.localSetKey(input.value || def.usual, key.value.trim());
          key.value = "";
          customKey = true;
        }
        const server = await Bridge.localConnect(id, input.value);
        if (!server.models.length) {
          clear(status);
          status.append(h("div", { class: "notice err", text: CHAT_STRINGS.noModels(t(def.name)) }));
        } else {
          settings[field] = server.url;
          if (!server.models.includes(settings.chatModels[id] ?? "")) {
            settings.chatModels = { ...settings.chatModels, [id]: server.models[0] };
          }
          await save();
          redraw();
          return;
        }
      } catch (err) {
        clear(status);
        status.append(h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }));
      }
      connect.disabled = false;
    });

    block.append(h("div", { class: "row" }, label, input, connect));
    if (id === "custom") block.append(h("div", { class: "row" }, h("label", { text: "" }), key));
    block.append(status, exposure);
    showExposure();
    return block;
  }

  redraw();
  localRedraw = redraw;
  return section;
}

// ── Integrations section ──────────────────────────────────────────────────────

interface IntegrationDef {
  id: string;
  name: string;
  color: string;
  /** Credential Manager keys, in the order they are shown. */
  fields: { key: string; label: string; placeholder: string; secret: boolean }[];
  /** What the key needs, shown under its field. */
  hint?: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  { id: "integration_stripe", name: "Stripe", color: "#0570DE",
    fields: [{ key: "stripe-api-key", label: N_("Secret key"), placeholder: "sk_live_…", secret: true }] },
  { id: "integration_github", name: "GitHub", color: "#F4505E",
    fields: [{ key: "github-token", label: N_("Token"), placeholder: "ghp_…", secret: true }],
    hint: N_("Classic token with the repo scope, or fine-grained with read access to Pull requests, Commit statuses and Actions.") },
  { id: "integration_gitlab", name: "GitLab", color: "#FC6D26",
    fields: [
      { key: "gitlab-url", label: N_("Instance URL"), placeholder: "https://gitlab.com", secret: false },
      { key: "gitlab-token", label: N_("Token"), placeholder: "glpat-…", secret: true },
    ],
    hint: N_("Personal access token with read_api and read_user scopes.") },
  { id: "integration_gitea", name: "Gitea", color: "#609926",
    fields: [
      { key: "gitea-url", label: N_("Instance URL"), placeholder: "https://gitea.example.com", secret: false },
      { key: "gitea-token", label: N_("Token"), placeholder: "…", secret: true },
    ] },
  { id: "integration_vercel", name: "Vercel", color: "#7C5CFF",
    fields: [{ key: "vercel-token", label: N_("Token"), placeholder: "…", secret: true }] },
  { id: "integration_n8n", name: "n8n", color: "#F29B38",
    fields: [
      { key: "n8n-url", label: N_("Instance URL"), placeholder: "https://n8n.example.com", secret: false },
      { key: "n8n-api-key", label: N_("API key"), placeholder: "…", secret: true },
    ] },
  { id: "integration_resend", name: "Resend", color: "#22C55E",
    fields: [{ key: "resend-api-key", label: N_("API key"), placeholder: "re_…", secret: true }] },
  { id: "integration_notion", name: "Notion", color: "#8C8C8C",
    fields: [{ key: "notion-api-key", label: N_("Integration token"), placeholder: "ntn_…", secret: true }] },
  { id: "integration_calcom", name: "Cal.com", color: "#C9956A",
    fields: [{ key: "calcom-api-key", label: N_("API key"), placeholder: "cal_…", secret: true }] },
  // Nothing to enter: the player is read from the OS (src-tauri/src/spotify.rs).
  { id: "integration_spotify", name: t("Music"), color: "#1DB954", fields: [] },
  // Nothing to enter either: CPU, memory and the battery are read on this
  // computer (src-tauri/src/system_health.rs).
  { id: "integration_system", name: t("System"), color: "#38BDF8", fields: [] },
];

const MAX_ACTIVE = MAX_DECLARED;

/** Everything that shows the declared pills, redrawn when any of them changes. */
const declaredViews: (() => void)[] = [];

function declaredChanged() {
  for (const redraw of declaredViews) redraw();
  void save();
}

/** WhatsApp (experimental), under the other integrations: its pill is turned on from its own switch. */
function whatsappSections(): HTMLElement[] {
  if (!availablePills().some((p) => p.id === WHATSAPP_ID)) return [];
  return [whatsappSection({
    toggle,
    maxPills: MAX_ACTIVE,
    pillActive: () => settings.activeIntegrations.includes(WHATSAPP_ID),
    setPill: (on) => {
      const has = settings.activeIntegrations.includes(WHATSAPP_ID);
      if (on && !has && settings.activeIntegrations.length < MAX_ACTIVE) {
        settings.activeIntegrations = [...settings.activeIntegrations, WHATSAPP_ID];
      } else if (!on && has) {
        settings.activeIntegrations = settings.activeIntegrations.filter((x) => x !== WHATSAPP_ID);
      } else {
        return;
      }
      declaredChanged();
    },
  })];
}

// ── General section ───────────────────────────────────────────────────────────

function generalSection(): HTMLElement {
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    value: String(settings.soundVolume),
  }) as HTMLInputElement;
  volume.addEventListener("input", () => {
    settings.soundVolume = Number(volume.value);
    void save();
  });

  // Your own sounds: the folder, a reload, and how many are replaced.
  const customCount = h("span", { class: "hint" });
  const countCustom = () =>
    void Bridge.customSounds(SOUND_NAMES).then((own) => {
      const n = own?.length ?? 0;
      customCount.textContent = n > 0 ? t("{0} custom", { 0: n }) : "";
    });
  countCustom();
  const soundsFolder = h("button", { text: t("Open sounds folder"), onclick: () => void Bridge.revealSoundsFolder() });
  const reloadSounds = h("button", {
    text: t("Reload sounds"),
    onclick: () => void Bridge.reloadSounds().then(() => window.setTimeout(countCustom, 300)),
  });

  const autoClose = h("input", {
    type: "number", min: "5", max: "120", step: "1",
    value: String(Math.round(settings.autoCloseInterval)),
    style: "width:72px",
  }) as HTMLInputElement;
  autoClose.addEventListener("change", () => {
    settings.autoCloseInterval = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(settings.autoCloseInterval);
    void save();
  });

  // The closed island (core/closed.ts): what stays at the top of the screen.
  const closed = h("select", {}) as HTMLSelectElement;
  closed.append(
    h("option", { value: "mochi", text: t("Miku, as on a Mac without a notch") }),
    h("option", { value: "time", text: t("The time") }),
    h("option", { value: "datetime", text: t("The date and the time") }),
    h("option", { value: "claude", text: t("Claude usage") }),
    h("option", { value: "music", text: t("What's playing") }),
    h("option", { value: "empty", text: t("Nothing, just the island") }),
    h("option", { value: "hidden", text: t("Hide the island") }),
  );
  closed.value = closedIsland(settings.closedIsland);
  closed.addEventListener("change", () => {
    settings.closedIsland = closed.value;
    void save();
  });

  const screen = h("select", {}) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: t("Main display") }),
    h("option", { value: "cursor", text: t("Display under the cursor") }),
  );
  screen.value = settings.screen;
  void Bridge.listMonitors().then((list) => {
    for (const m of list ?? []) screen.append(h("option", { value: m.key, text: m.label }));
    // Set again now the option exists. A display saved under an older key (moved,
    // resized, or saved before names were kept) is shown by its place or its
    // name; one that is gone shows as the main one.
    const saved = settings.screen;
    const [place, name] = saved.split("|");
    const keys = (list ?? []).map((m) => m.key);
    screen.value =
      keys.find((k) => k === saved) ??
      (saved.startsWith("at:") ? keys.find((k) => k.split("|")[0] === place) : undefined) ??
      (name ? keys.find((k) => k.split("|")[1] === name) : undefined) ??
      saved;
    if (!screen.value) screen.value = "primary";
  });
  screen.addEventListener("change", () => {
    settings.screen = screen.value;
    void save();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("General") })),
    anchor("general.sound", h("div", { class: "row" },
      h("label", { text: t("Sound") }),
      toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }),
      volume,
    )),
    h("div", { class: "row" }, soundsFolder, reloadSounds, customCount),
    h("div", { class: "hint", text: t("Drop a file named like one of Miku's sounds (finish.wav, approval.mp3, greet.m4a…) in the sounds folder to replace it, then Reload.") }),
    // Required by the voice library's terms: the credit has to be somewhere a
    // user can find it. `scripts/voice-cues.mjs` writes the cues made with it.
    anchor("general.voicecredit", h("div", { class: "hint" },
      h("span", { text: t("Voice cues can be made with VOICEVOX:ずんだもん / VOICEVOX:四国めたん, © SSS LLC, under its terms.") }),
    )),
    anchor("general.behavior", h("div", { class: "row" },
      h("label", { text: t("Open on hover") }),
      toggle(settings.openOnHover, (v) => { settings.openOnHover = v; void save(); }),
    )),
    h("div", { class: "hint", text: t("Hovering the island opens it; it folds again shortly after the pointer leaves. Click inside to keep it open.") }),
    h("div", { class: "row" },
      h("label", { text: t("Open for every pill’s alerts") }),
      toggle(settings.alertsFromAllPills, (v) => { settings.alertsFromAllPills = v; void save(); }),
    ),
    h("div", { class: "hint", text: t("When a pill other than the one shown finishes or hits an error, the notch shows it for a moment, then the pill you had comes back.") }),
    h("div", { class: "row" },
      h("label", { text: t("Show clock in the island") }),
      toggle(settings.showClock, (v) => { settings.showClock = v; void save(); }),
    ),
    h("div", { class: "hint", text: t("The date and the time in the middle of the island when it is compact.") }),
    anchor("general.display", h("div", { class: "row" },
      h("label", { text: t("Closed island shows") }),
      closed,
    )),
    h("div", { class: "hint", text: t("A PC has no notch: once closed, a small island stays at the top of the screen. Hover it to bring Miku back. Hidden, move the pointer to the very top of the screen.") }),
    h("div", { class: "row" },
      h("label", { text: t("Auto-close") }),
      autoClose,
      h("span", { class: "hint", text: t("seconds after you leave the island") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Island lives on") }),
      screen,
    ),
    h("div", { class: "row" },
      h("label", { text: t("LINE & Discord in the island") }),
      toggle(settings.pcNotifications, (v) => { settings.pcNotifications = v; void save(); }),
    ),
    h("div", { class: "hint", text: t("Reads the notifications LINE and Discord show on this PC (Windows' notification list), only while this is on. Nothing is sent anywhere or kept. Replies open the app.") }),
    anchor("general.startup", h("div", { class: "row" },
      h("label", { text: t("Launch at startup") }),
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    )),
    ...recapRows(),
    ...updateRows(toggle, version),
    ...lyricsRows(toggle),
    languageRow(),
  );
}

/**
 * Settings → General → Floating lyrics: the switch asks Rust (lyrics.rs), which
 * owns the overlay's window and remembers whether it is on. The card's size,
 * the words' size and colour, and how see-through it is live here, in the
 * settings every window already reads.
 */
function lyricsRows(toggle: (on: boolean, onChange: (v: boolean) => void) => HTMLElement): HTMLElement[] {
  const el = toggle(false, (v) => void Bridge.lyricsSetVisible(v));
  void Bridge.lyricsVisible().then((shown) => {
    el.classList.toggle("on", shown === true);
    el.setAttribute("aria-pressed", String(shown === true));
  });

  /** A labelled slider that writes `apply` on every move, so the card follows. */
  const slider = (
    label: string,
    min: number,
    max: number,
    step: number,
    read: () => number,
    write: (v: number) => void,
  ): HTMLElement => {
    const input = h("input", {
      type: "range",
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(read()),
      class: "lyrics-slider",
    }) as HTMLInputElement;
    input.addEventListener("input", () => {
      write(Number(input.value));
      void save();
    });
    return h("div", { class: "row" }, h("label", { text: label }), input);
  };

  /** A colour well: the browser's own picker, stored as #rrggbb. */
  const colour = (label: string, read: () => string, write: (v: string) => void): HTMLElement => {
    const input = h("input", { type: "color", value: read(), class: "lyrics-colour" }) as HTMLInputElement;
    input.addEventListener("input", () => {
      write(input.value);
      void save();
    });
    return h("div", { class: "row" }, h("label", { text: label }), input);
  };

  const placement = h("select", {}) as HTMLSelectElement;
  placement.append(
    h("option", { value: "island", text: t("In the top pill") }),
    h("option", { value: "floating", text: t("Floating") }),
  );
  placement.value = settings.lyrics?.placement ?? settings.lyricsPlacement ?? "island";
  placement.addEventListener("change", () => {
    const value = placement.value === "floating" ? "floating" : "island";
    settings.lyricsPlacement = value;
    if (settings.lyrics) settings.lyrics.placement = value;
    void Bridge.lyricsSetPlacement(value);
  });

  /** A setting with its one-line explanation under the name (the mockup's rows). */
  const named = (name: string, sub: string, control: HTMLElement) =>
    h("div", { class: "row lyr-row" },
      h("label", {}, h("span", { class: "lyr-name", text: name }), h("span", { class: "lyr-sub", text: sub })),
      control);

  // The languages to romanise: Japanese and Korean now, Mandarin later.
  const langs = new Set(settings.lyricsRomajiLangs ?? ["ja", "ko"]);
  const chip = (code: string, label: string) => {
    const b = h("button", { class: langs.has(code) ? "lyr-chip on" : "lyr-chip", text: label });
    b.addEventListener("click", () => {
      if (langs.has(code)) langs.delete(code);
      else langs.add(code);
      b.classList.toggle("on", langs.has(code));
      settings.lyricsRomajiLangs = [...langs];
      void save();
      void paintPreview();
    });
    return b;
  };
  const soon = h("span", { class: "lyr-chip soon", text: `${t("Mandarin")} · ${t("Soon")}` });

  // What the switches do, on two real lines.
  const SAMPLES = ["私の心は君のもの", "사랑해요"];
  const preview = h("div", { class: "lyr-preview" });
  const paintPreview = async () => {
    if (settings.lyricsRomanize !== false && langs.has("ja")) await ensureJapaneseTokenizer();
    preview.replaceChildren(h("div", { class: "lyr-preview-head", text: t("Preview") }));
    for (const line of SAMPLES) {
      const out = settings.lyricsRomanize === false
        ? line
        : romanizeMixed(line, languageOfLines([line]), [...langs]);
      preview.append(h("div", { text: line }));
      if (out !== line) preview.append(h("div", { class: "lyr-preview-out", text: `→ ${out}` }));
    }
  };
  void paintPreview();

  const translate = toggle(false, () => undefined);
  translate.classList.add("disabled");
  translate.setAttribute("aria-disabled", "true");

  return [
    h("div", { class: "lyr-title" }, h("span", { text: `🎵 ${t("Lyrics")}` }), h("span", { class: "lyr-crumb", text: `${t("Settings")} › ${t("Music")}` })),
    anchor("general.lyrics", named(t("Show the lyrics"), t("On the stage under Miku while a song plays, or on a floating card"), el)),
    named(t("Placement"), t("In the island, or a card you can drag anywhere"), placement),
    named(t("Romanise the lyrics"), t("Japanese and Korean letters become Latin"),
      toggle(settings.lyricsRomanize, (v) => { settings.lyricsRomanize = v; void save(); void paintPreview(); })),
    h("div", { class: "lyr-langs" },
      h("div", { class: "lyr-sub", text: t("Languages to romanise") }),
      h("div", { class: "lyr-chips" }, chip("ja", t("Japanese")), chip("ko", t("Korean")), soon)),
    named(t("Show the words as written"), t("Small, under the romanised line"),
      toggle(settings.lyricsShowOriginal, (v) => { settings.lyricsShowOriginal = v; void save(); })),
    named(t("Translation"), t("Needs a translation service you set up yourself. Coming later."), translate),
    named(t("Show lyrics for videos too"), t("Ordinary browser videos may open the lyrics as well"),
      toggle(settings.lyricsVideos, (v) => { settings.lyricsVideos = v; void save(); })),
    preview,
    h("div", { class: "subhead", text: t("The card") }),
    h("div", { class: "row" },
      h("label", { text: t("Lock position") }),
      toggle(settings.lyricsLocked, (v) => { settings.lyricsLocked = v; void save(); }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Click through the card") }),
      toggle(settings.lyricsClickThrough, (v) => { settings.lyricsClickThrough = v; void save(); }),
    ),
    h("div", { class: "hint", text: t("Clicks go to the window under the card. Turn it off here to drag the card or open its menu again.") }),
    slider(t("Opacity"), 0, 1, 0.05, () => settings.lyricsOpacity, (v) => { settings.lyricsOpacity = v; }),
    h("div", { class: "hint", text: t("Lower lets the wallpaper show through the card; the words keep their shadow.") }),
    slider(t("Text size"), 10, 40, 1, () => settings.lyricsFontSize, (v) => { settings.lyricsFontSize = v; }),
    slider(t("Width"), 200, 900, 10, () => settings.lyricsWidth, (v) => {
      settings.lyricsWidth = v;
      void Bridge.lyricsResize(settings.lyricsWidth, settings.lyricsHeight);
    }),
    slider(t("Height"), 90, 400, 10, () => settings.lyricsHeight, (v) => {
      settings.lyricsHeight = v;
      void Bridge.lyricsResize(settings.lyricsWidth, settings.lyricsHeight);
    }),
    colour(t("Text colour"), () => settings.lyricsTextColor, (v) => { settings.lyricsTextColor = v; }),
    colour(t("Card colour"), () => settings.lyricsBackground, (v) => { settings.lyricsBackground = v; }),
    h("div", { class: "hint", text: t("A small window that follows what Spotify plays and shows the line being sung, with the ones around it. Drag it anywhere; it stays where you leave it.") }),
  ];
}

/**
 * Settings → General → Language, as on the Mac: "System" follows the
 * system's language when Miku has it (else English), or one of the ten.
 * Both windows and the tray switch in place, without a restart.
 */
function languageRow(): HTMLElement {
  const select = h("select", {}) as HTMLSelectElement;
  select.append(h("option", { value: "", text: t("System") }));
  for (const { code, name } of LANGUAGES) select.append(h("option", { value: code, text: name, lang: code }));
  select.value = LANGUAGES.some((l) => l.code === settings.language) ? settings.language : "";
  select.addEventListener("change", () => {
    settings.language = select.value;
    void save();
    applyLanguage();
  });
  return anchor("general.language", h("div", { class: "row" }, h("label", { text: t("Language") }), select));
}

// ── Shortcuts section ─────────────────────────────────────────────────────────

const SHORTCUTS_UI = {
  get title() { return t("Shortcuts"); },
  get hint() { return t("Work from any app. Click a shortcut to change it, then press the new keys — Esc cancels, Backspace removes it."); },
  get global() { return t("From anywhere"); },
  get island() { return t("In the open island"); },
  get recording() { return t("Press keys…"); },
  get none() { return t("None"); },
  get reset() { return t("Reset to defaults"); },
  get inUse() { return t("In use by another app"); },
  get duplicate() { return t("Used twice"); },
  get invalid() { return t("Not a valid shortcut"); },
  get unavailable() { return t("Not available"); },
  types: (ch: string) => t("Types “{char}”", { char: ch }),
  typesNote: (keys: string, ch: string) =>
    t("{keys} types “{char}” on your keyboard, so it can't be a shortcut. Pick another key.", { keys, char: ch }),
  get needsModifier() { return t("Hold Ctrl, Alt or the Windows key with it."); },
  get unsupportedKey() { return t("That key can't be used in a shortcut."); },
  get wayland() {
    return t("Your Wayland desktop doesn't let apps listen for keys outside their own windows. Add the shortcuts in your system's keyboard settings instead, with these commands:");
  },
  get noDisplay() { return t("No display server was found, so global shortcuts are off."); },
  get portalPending() {
    return t("Asking your desktop to register the shortcuts. It may show its own window to confirm them.");
  },
  get portalActive() {
    return t("These shortcuts are registered with your desktop. It may ask you to confirm them or to pick other keys; when it says which keys it uses, they show next to each shortcut.");
  },
  get portalFallback() {
    return t("If one doesn't work, you can also add it in your system's keyboard settings with these commands:");
  },
  desktopKeys: (keys: string) => t("Desktop: {keys}", { keys }),
  get refused() { return t("Not set by your desktop"); },
};

function shortcutsSection(initial: ShortcutsReport | null): HTMLElement {
  let report = initial;
  const list = h("div", { class: "shortcut-list" });
  const feedback = h("div", {});
  const blockedNote = h("div", {});

  let stopRecording: (() => void) | null = null;

  function store(id: string, binding: Binding) {
    settings.shortcuts = { ...settings.shortcuts, [id]: binding };
    void save();
  }

  function tagFor(id: string, dups: Set<string>): HTMLElement | null {
    if (dups.has(id)) return h("span", { class: "tag err", text: SHORTCUTS_UI.duplicate });
    const st = report?.actions.find((a) => a.id === id);
    switch (st?.status) {
      case "inUse": return h("span", { class: "tag warn", text: SHORTCUTS_UI.inUse });
      case "duplicate": return h("span", { class: "tag err", text: SHORTCUTS_UI.duplicate });
      case "invalid": return h("span", { class: "tag err", text: SHORTCUTS_UI.invalid });
      case "typesCharacter": return h("span", { class: "tag warn", text: SHORTCUTS_UI.types(st.typed ?? "?") });
      case "unsupported": return h("span", { class: "tag", text: SHORTCUTS_UI.unavailable });
      case "refused": return h("span", { class: "tag warn", text: SHORTCUTS_UI.refused });
      // Wayland: the desktop may run it on other keys than the ones asked for.
      case "active": return st.trigger ? h("span", { class: "tag", text: SHORTCUTS_UI.desktopKeys(st.trigger) }) : null;
      default: return null;
    }
  }

  function record(id: string, binding: Binding, button: HTMLButtonElement) {
    stopRecording?.();
    clear(feedback);
    button.classList.add("recording");
    button.textContent = SHORTCUTS_UI.recording;
    void Bridge.shortcutsSuspend(true);

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const result = recordPress(e);
      switch (result.kind) {
        case "pending":
          return;
        case "keys":
          finish();
          store(id, { keys: result.keys, enabled: true });
          return;
        case "clear":
          finish();
          store(id, { keys: "", enabled: binding.enabled });
          return;
        case "typesCharacter":
          finish();
          feedback.append(h("div", {
            class: "notice warn",
            text: SHORTCUTS_UI.typesNote(displayKeys(result.keys), result.typed),
          }));
          return;
        case "needsModifier":
          feedback.replaceChildren(h("div", { class: "notice warn", text: SHORTCUTS_UI.needsModifier }));
          return;
        case "unsupported":
          feedback.replaceChildren(h("div", { class: "notice warn", text: SHORTCUTS_UI.unsupportedKey }));
          return;
        case "cancel":
          finish();
          return;
      }
    };
    const onBlur = () => finish();

    function finish() {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      stopRecording = null;
      // Takes the global shortcuts back, from what is saved by now.
      void Bridge.shortcutsSuspend(false);
      draw();
    }
    stopRecording = finish;
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
  }

  function draw() {
    clear(list);
    const dups = duplicates(activeKeys(settings.shortcuts));
    for (const d of SHORTCUTS) {
      if (!d.ported) continue;
      const binding = effective(d, settings.shortcuts);
      const keycap = h("button", {
        class: "keycap",
        text: binding.keys ? displayKeys(binding.keys) : SHORTCUTS_UI.none,
      }) as HTMLButtonElement;
      keycap.disabled = !binding.enabled;
      keycap.addEventListener("click", () => record(d.id, binding, keycap));
      const sw = toggle(binding.enabled, (on) => store(d.id, { keys: binding.keys, enabled: on }));
      const tag = binding.enabled ? tagFor(d.id, dups) : null;
      list.append(h("div", { class: binding.enabled ? "row shortcut" : "row shortcut off" },
        sw,
        h("span", { class: "shortcut-name", text: t(SHORTCUT_TEXT[d.id]) }),
        ...(tag ? [tag] : []),
        keycap,
      ));
    }

    clear(blockedNote);
    const commands = (command: string) => {
      const list = h("div", { class: "diff" });
      for (const d of SHORTCUTS) {
        if (d.ported) list.append(h("div", { class: "ctx", text: `${command} ${d.id}` }));
      }
      return list;
    };
    if (report?.portal) {
      // Wayland, through the desktop's GlobalShortcuts portal; the commands
      // stay as a way around a shortcut the desktop didn't take.
      const active = report.portal === "active";
      blockedNote.append(
        h("div", {
          class: active ? "notice ok" : "notice",
          text: active ? SHORTCUTS_UI.portalActive : SHORTCUTS_UI.portalPending,
        }),
        h("div", { class: "hint", text: SHORTCUTS_UI.portalFallback }),
        commands(report.command),
      );
    } else if (report?.blocked === "wayland") {
      blockedNote.append(h("div", { class: "notice warn", text: SHORTCUTS_UI.wayland }), commands(report.command));
    } else if (report?.blocked) {
      blockedNote.append(h("div", { class: "notice warn", text: SHORTCUTS_UI.noDisplay }));
    }
  }

  const islandList = h("div", { class: "shortcut-list" });
  islandList.dataset.anchor = "shortcuts.island";
  for (const row of ISLAND_SHORTCUTS) {
    islandList.append(h("div", { class: "row shortcut" },
      h("span", { class: "shortcut-name", text: t(row.description) }),
      h("span", { class: "keycap static", text: row.keys }),
    ));
  }

  const reset = h("button", {
    text: SHORTCUTS_UI.reset,
    onclick: () => {
      stopRecording?.();
      settings.shortcuts = {};
      clear(feedback);
      void save();
      draw();
    },
  });

  // The events are listened to once (see main); only the section on screen redraws.
  shortcutsListener = {
    report(fresh) {
      report = fresh;
      if (!stopRecording) draw();
    },
    settingsChanged() {
      if (!stopRecording) draw();
    },
  };

  draw();
  return anchor("shortcuts.global", h(
    "section",
    {},
    h("h2", {}, h("span", { text: SHORTCUTS_UI.title })),
    h("div", { class: "hint", text: SHORTCUTS_UI.hint }),
    h("div", { class: "subhead", text: SHORTCUTS_UI.global }),
    list,
    blockedNote,
    feedback,
    h("div", { class: "row" }, reset),
    h("div", { class: "subhead", text: SHORTCUTS_UI.island }),
    islandList,
  ));
}

/** Settings → General → Weekly recap. The prefs live with the history in Rust. */
function recapRows(): HTMLElement[] {
  const T = {
    label: t("Weekly recap"),
    keep: t("Keep a history of my coding sessions"),
    clear: t("Clear history"),
    cleared: t("History cleared."),
    about: t("Counts and project names only — never commands, files or prompts. Kept on this computer for 12 weeks."),
  };
  const feedback = h("span", { class: "hint" });
  const sw = toggle(true, (v) => { void Bridge.recapSetEnabled(v); });  void Bridge.recapPrefs().then((prefs) => {
    if (prefs) sw.classList.toggle("on", prefs.enabled);
  });
  const clearBtn = h("button", {
    class: "danger",
    text: T.clear,
    onclick: async () => {
      clearBtn.disabled = true;
      await Bridge.recapClear();
      feedback.textContent = T.cleared;
      window.setTimeout(() => {
        clearBtn.disabled = false;
        feedback.textContent = "";
      }, 2400);
    },
  }) as HTMLButtonElement;
  return [
    anchor("general.recap", h("div", { class: "row" },
      h("label", { text: T.label }),
      sw,
      h("span", { class: "hint", text: T.keep }),
    )),
    h("div", { class: "row" },
      h("label", {}),
      clearBtn,
      feedback,
    ),
    h("div", { class: "row" },
      h("label", {}),
      h("span", { class: "hint", style: "flex:1 1 0;min-width:0", text: T.about }),
    ),
  ];
}

// ── Language ──────────────────────────────────────────────────────────────────

/** The shortcuts section on screen, told about the events listened to once in main. */
let shortcutsListener: { report(fresh: ShortcutsReport): void; settingsChanged(): void } | null = null;

/**
 * Shows the language Settings asks for. A change redraws the window in place,
 * where it was scrolled to: nothing reloads, nothing is written.
 */
function applyLanguage() {
  setLanguage(resolveLanguage(settings.language, systemLanguages()));
}

function applyDirection() {
  document.documentElement.dir = isRtl() ? "rtl" : "ltr";
  document.title = t("Miku");
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main() {
  const boot = await Bridge.boot();
  if (boot) {
    settings = { ...settings, ...boot.settings };
    version = boot.version;
  }
  // This window keeps its settings in `settings`; the shared State is what
  // hub/hero.ts reads, and it used to stay at the defaults here.
  State.settings = settings;
  setLanguage(resolveLanguage(settings.language, systemLanguages()));
  applyDirection();
  // The window wears the skin picked in the wardrobe, and follows it from any
  // window (a hovered swatch included).
  watchSkin();
  hub = await startHub(windowRoot, {
    version,
    flowPages: FLOW_PAGE_RENDERERS,
    renderNotch: async (page, container) => {
      notchPage = page;
      root = container;
      await render();
    },
  });
  onLanguageChange(() => {
    applyDirection();
    hub?.redraw();
  });

  void onEvent<ShortcutsReport>("shortcuts-status", (fresh) => shortcutsListener?.report(fresh));
  void onEvent<UpdateStatus>("update-status", (fresh) => updatesListener?.(fresh));
  void onEvent<Settings>("settings-changed", (s) => {
    const before = `${settings.chatProvider}|${settings.ollamaUrl}|${settings.lmstudioUrl}|${settings.customUrl}`;
    settings = { ...settings, ...s };
    State.settings = settings;
    shortcutsListener?.settingsChanged();
    for (const redraw of declaredViews) redraw();
    const after = `${settings.chatProvider}|${settings.ollamaUrl}|${settings.lmstudioUrl}|${settings.customUrl}`;
    if (before !== after) localRedraw?.();
    applyLanguage();
  });
}

/** The Notch page being shown. */
let notchPage: PageId = "general";

/** Reads what the sections of the Notch page show and draws them. */
async function render() {
  const status = (await Bridge.hooksStatus()) ?? {
    installed: false, planRelayInstalled: false, settingsPath: "", hookPath: "", hookReady: false,
  };
  const agents = await Bridge.agentHooksList();

  const hasKey = (await Bridge.secretPresent("anthropic-api-key")) ?? false;
  const claudeRelay = !hasKey && ((await Bridge.claudeReady()) ?? false);
  const shortcutReport = await Bridge.shortcutsStatus();

  const keys = [
    "stripe-api-key", "github-token", "gitlab-url", "gitlab-token", "gitea-url", "gitea-token", "vercel-token",
    "n8n-url", "n8n-api-key", "resend-api-key", "notion-api-key", "calcom-api-key",
  ];
  const present: Record<string, boolean> = {};
  for (const k of keys) present[k] = (await Bridge.secretPresent(k)) ?? false;

  // A main pill this build can run, and no pill declared twice.
  settings = { ...settings, ...sanitizeDeclared(settings) };
  presentKeys = present;
  const connected: Record<string, boolean> = { ...((await Bridge.agentHooksStatus()) ?? {}) };
  for (const def of availablePills()) {
    if (def.connect.kind === "key") {
      connected[def.id] = present[def.connect.key] ?? (await Bridge.keyReady(def.connect.key)) ?? false;
    }
  }
  /** A chat provider's key was saved or removed: its pill's row says so at once. */
  const keyChanged = (key: string, on: boolean) => {
    for (const def of availablePills()) {
      if (def.connect.kind === "key" && def.connect.key === key) connected[def.id] = on;
    }
    for (const redraw of declaredViews) redraw();
  };
  const chatKeys: Record<string, boolean> = {};
  for (const def of CLOUD) {
    const key = providerDef(def.id).key!;
    chatKeys[key] = (await Bridge.secretPresent(key)) ?? false;
  }
  const customKey = (await Bridge.secretPresent(CUSTOM_SERVER_KEY)) ?? false;

  declaredViews.length = 0;
  localRedraw = null;
  shortcutsListener = null;
  clear(root);
  const sections: Partial<Record<PageId, () => HTMLElement[]>> = {
    general: () => [generalSection()],
    // The Settings page's "The island" tab draws the general settings, under a
    // band that belongs to Settings rather than to the island's own page.
    islandSettings: () => [generalSection()],
    pills: () => [pillsSection(connected), ...whatsappSections()],
    agents: () => [claudeSection(status), agentsSection(agents), approvalsSection(settings.approvalModes ?? {}, (modes) => {
      settings.approvalModes = modes;
      void Bridge.approvalModesSet(modes);
    }), planSection(status)],
    chat: () => [subscriptionsSection(), apiSection(hasKey, claudeRelay), chatProvidersSection(chatKeys, keyChanged), localSection(customKey)],
    shortcuts: () => [shortcutsSection(shortcutReport)],
  };
  root.append(...(sections[notchPage]?.() ?? []));
  if (notchPage === "general") {
    root.append(h("div", {
      class: "hint",
      text: t("No telemetry. Network requests only go to the services you configure yourself."),
    }));
  }
}

void main();
