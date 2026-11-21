// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { buildDeck, openDeckOn } from "./deck";
import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { State, type AgentTask } from "../core/state";
import type { IslandViewName, Tone } from "../core/layout";
import type { ChibiPose } from "../mochi/chibi";
import { buildPrompt } from "./chat";
import { pillDefinition } from "../core/pills";
import { buildPlanPill, claudePillVisible, codexPillVisible, refreshCodexPlanUsage } from "./usage";
import { lastTextStep } from "../core/diff";
import { buildRecap } from "./recap";
import { buildWardrobe } from "./wardrobe";
import { buildUpdate } from "./update";
import type { Outfit, OutfitSelection, VariantSelection } from "../mochi/wardrobe";
import type { MikuVariantId } from "../mochi/variants";
import { language, t, tl, type Msg } from "../i18n/i18n";
import type { ViewCommand } from "../island/shortcuts";

export interface ViewActions {
  /** Her sulk after three pokes (BotEngine.poke), for views that draw their own Miku. */
  pokedPose(): ChibiPose | null;
  setView(v: IslandViewName): void;
  collapse(): void;
  /** Folds a waiting card to the compact island without answering it. */
  foldApproval(): void;
  setFocus(id: string): void;
  openTerminal(): void;
  /** The ↗ button: opens whatever the focused pill points at. */
  openTarget(): void;
  openUrl(url: string): void;
  decide(d: "allow" | "deny"): void;
  /** Answers the question Claude Code asked: question text → chosen label. */
  answer(answers: Record<string, string | string[]>): void;
  /** Hands the pending request back to the terminal. */
  answerInTerminal(): void;
  /** The card's Always: this tool asks no more (the Settings switch, flipped). */
  rememberApproval(): void;
  toggleSound(): void;
  setVolume(v: number): void;
  setAutoClose(seconds: number): void;
  openSettingsWindow(): void;
  blip(): void;
  /** Wardrobe click: keeps the outfit ("auto" and "none" included). */
  chooseOutfit(selection: OutfitSelection): void;
  /** Wardrobe hover: shows an outfit on Miku without keeping it; null ends it. */
  previewOutfit(outfit: Outfit | null): void;
  /** Wardrobe click: keeps the variant ("auto" follows the season). */
  chooseVariant(selection: VariantSelection): void;
  /** Wardrobe hover: shows a variant without keeping it; null ends it. */
  previewVariant(variant: MikuVariantId | null): void;
  /** The island takes the keyboard (a text field in a card) or gives it back. */
  keyboard(on: boolean): void;
  /** Something is being typed in a card: the island stays open until it is sent or cleared. */
  holdOpen(on: boolean): void;
  /** Turns one pill's slide on or off (declares it, as Settings does), and keeps it. */
  toggleSlide(id: string): void;
}

export interface ViewHost {
  el: HTMLElement;
  sync(): void;
  /** Called when the view becomes active, for views with a text field. */
  focus?(): void;
  /** Called every frame while the view is on screen. True = needs another frame. */
  tick?(nowMs: number): boolean | void;
  /** Ctrl+O / Ctrl+E while the view is on screen (island/shortcuts.ts). */
  command?(command: ViewCommand): void;
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function card(tone: Tone, ...children: (Node | string)[]): HTMLElement {
  return h("div", { class: tone ? `card lit ${tone}` : "card" }, ...children);
}

function btn(
  label: string | Msg,
  kind: "primary" | "secondary",
  onClick: () => void,
  kbd?: string,
): HTMLElement {
  return h(
    "button",
    { class: `btn ${kind}`, onclick: onClick },
    h("span", { text: label }),
    kbd ? h("span", { class: "kbd", text: kbd }) : null,
  );
}

/** AgentWho — coloured dot + task name + grey label. */
function agentWho(task: AgentTask | null, label: string): HTMLElement {
  const row = h("div", { class: "who-row" });
  if (task) {
    row.append(dot(task.color, 8), h("span", { class: "n", text: task.name }));
  }
  row.append(h("span", { text: label }));
  return row;
}

function stack(padLeft: number, padRight: number, ...children: Node[]): HTMLElement {
  const el = h("div", { class: "stack" }, ...children);
  el.style.padding = `4px ${padRight}px 4px ${padLeft}px`;
  return el;
}

// ── Header ────────────────────────────────────────────────────────────────────

export function buildHeader(actions: ViewActions): ViewHost {
  const tabHome = h("button", { class: "tab", title: tl("Overview"), onclick: () => go("overview") }, svg(ICONS.house, 17));
  const tabChat = h("button", { class: "tab", title: tl("Ask"), onclick: () => go("prompt") }, svg(ICONS.bubbleRound, 19));
  // Files go on the shelf: the deck, on its Shelf page.
  const tabDrop = h("button", {
    class: "tab",
    title: tl("Shelf"),
    onclick: () => {
      openDeckOn("shelf");
      go("overview");
    },
  }, svg(ICONS.plus, 16));

  const gearBtn = h("button", { title: tl("Settings"), onclick: () => go("settings") }, svg(ICONS.gearLine, 18, { stroke: 1.6 }));
  const soundBtn = h("button", { title: tl("Mute"), onclick: () => actions.toggleSound() }, svg(ICONS.speakerLine, 18, { stroke: 1.6 }));
  // Folds back to the compact island now, without waiting for the timer (the
  // Mac's ✕). A card waiting for an answer keeps the island open: no ✕ then.
  const closeBtn = h("button", { class: "close", title: tl("Close"), onclick: () => actions.collapse() }, svg(ICONS.xmark, 17));
  // Plan usage pills (off by default): before the gear, Claude first, as on the Mac.
  const claudePill = buildPlanPill(false);
  const codexPill = buildPlanPill(true);
  const planPills = h("div", { class: "plan-pills" }, claudePill.el, codexPill.el);
  let codexShown = false;

  function go(v: IslandViewName) {
    actions.blip();
    actions.setView(v);
  }

  // The overview's pager: one dot per slide, the arrows, and Edit to choose them.
  const prevBtn = h("button", { class: "pager-step", title: tl("Previous"), onclick: () => stepSlide(actions, -1) }, svg(ICONS.chevronLeft, 9));
  const nextBtn = h("button", { class: "pager-step", title: tl("Next"), onclick: () => stepSlide(actions, 1) }, svg(ICONS.chevronRight, 9));
  const dots = h("div", { class: "pager-dots" });
  const editBtn = h("button", {
    class: "pager-edit",
    onclick: () => {
      actions.blip();
      slideEditing = !slideEditing;
      State.notify();
    },
  });
  const pager = h("div", { class: "pager" }, prevBtn, dots, nextBtn, editBtn);
  let pagerKey = "";

  const el = h(
    "div",
    { id: "header" },
    h("div", { class: "tabs" }, tabHome, tabChat, tabDrop),
    pager,
    h("div", { class: "header-actions" }, planPills, gearBtn, soundBtn, closeBtn),
  );
  const headerActions = el.lastElementChild as HTMLElement;

  let gearKey = "";
  let soundKey = "";
  return {
    el,
    sync() {
      const v = State.view;
      tabHome.classList.toggle("on", v === "overview" || v === "empty");
      tabChat.classList.toggle("on", v === "prompt");
      gearBtn.classList.toggle("on", v === "settings");
      // The icons are rebuilt only when what they show changes: a fresh SVG
      // per state change was re-laid-out for nothing.
      const gk = v === "settings" ? "fill" : "line";
      if (gk !== gearKey) {
        gearKey = gk;
        clear(gearBtn);
        gearBtn.append(v === "settings" ? svg(ICONS.gearFill, 18) : svg(ICONS.gearLine, 18, { stroke: 1.6 }));
      }
      const sk = State.settings.soundEnabled ? "on" : "off";
      if (sk !== soundKey) {
        soundKey = sk;
        clear(soundBtn);
        soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerLine : ICONS.speakerSlashLine, 18, { stroke: 1.6 }));
      }
      closeBtn.style.display = State.pendingApproval ? "none" : "";
      pager.style.display = v === "overview" ? "" : "none";
      if (v === "overview") syncPager();
      syncPlanPills();
    },
  };

  function syncPager() {
    const focus = State.focusTask?.id ?? null;
    const key = State.tasks.map((t) => `${t.id}:${t.color}:${t.pillBadge ?? ""}:${t.name}`).join("|") +
      `~${focus}~${slideEditing}~${language()}`;
    if (key === pagerKey) return;
    pagerKey = key;
    clear(dots);
    for (const task of State.tasks) {
      const b = h("button", {
        class: `pager-dot${task.id === focus ? " on" : ""}${task.pillBadge ? ` badge-${task.pillBadge}` : ""}`,
        title: slideLabel(task),
        onclick: () => actions.setFocus(task.id),
      });
      b.style.setProperty("--pill", task.color);
      dots.append(b);
    }
    const i = State.tasks.findIndex((t) => t.id === focus);
    prevBtn.toggleAttribute("disabled", slideEditing || i <= 0);
    nextBtn.toggleAttribute("disabled", slideEditing || i < 0 || i >= State.tasks.length - 1);
    dots.classList.toggle("dim", slideEditing);
    editBtn.classList.toggle("on", slideEditing);
    editBtn.title = slideEditing ? t("Done") : t("Edit");
    clear(editBtn);
    editBtn.append(svg(slideEditing ? ICONS.check : ICONS.stack, 11, { stroke: slideEditing ? 2.4 : 0 }));
  }

  function syncPlanPills() {
    const claudeOn = claudePillVisible();
    const codexOn = codexPillVisible();
    claudePill.el.style.display = claudeOn ? "" : "none";
    codexPill.el.style.display = codexOn ? "" : "none";
    planPills.classList.toggle("on", claudeOn || codexOn);
    // Both pills: the right side tightens so it still clears the screen edge.
    headerActions.classList.toggle("both-plans", claudeOn && codexOn);
    if (claudeOn) claudePill.sync();
    if (codexOn) codexPill.sync();
    // Codex is asked when its pill comes into view (stale answers only).
    const shown = codexOn && State.mode === "expanded";
    if (shown && !codexShown) refreshCodexPlanUsage();
    codexShown = shown;
  }
}

// ── Overview ──────────────────────────────────────────────────────────────────

/**
 * IntegrationCardView.agentSessionActive: a workspace tool or an agent — or
 * any other tagged agent — with something going on.
 */
export function hasSessionTicker(task: AgentTask): boolean {
  // A pill made for an agent's session (Gemini CLI, Codex… not declared) only
  // exists while that session does: it keeps the ticker from the first event.
  if (task.source === "agent" && !task.isIntegration) return true;
  const category = pillDefinition(task.id)?.category;
  const isSession = category === "workspace" || category === "agent" ||
    (category == null && task.id.startsWith("agent_"));
  return isSession && (task.state !== "idle" || task.steps.length > 0);
}

// ── Slides ────────────────────────────────────────────────────────────────────

/** The overview's slides are being chosen (the pager's Edit). */
let slideEditing = false;

/** What a slide is called in the pager: its pill's name. */
function slideLabel(task: AgentTask): string {
  return task.id === "integration_claude" ? pillDefinition(task.id)!.name : task.name;
}

/** Shows the next (1) or previous (-1) slide; false at either end. */
function stepSlide(actions: ViewActions, dir: 1 | -1): boolean {
  const i = State.tasks.findIndex((x) => x.id === State.focusTask?.id);
  const next = State.tasks[i + dir];
  if (i < 0 || !next) return false;
  actions.setFocus(next.id);
  return true;
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function buildEmpty(actions: ViewActions): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px;flex-direction:row;align-items:center;gap:16px" },
    h(
      "div",
      { style: "display:flex;flex-direction:column;gap:5px" },
      h("div", { class: "title", text: tl("Nothing running right now.") }),
      h("div", { class: "sub", text: tl("Drop a file or window, or ask me anything.") }),
    ),
    h("div", { class: "grow" }),
    btn(tl("Ask Claude"), "primary", () => actions.setView("prompt")),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Ritual ────────────────────────────────────────────────────────────────────

/** The ritual card: a break worth taking, a milestone worth a nod. One line,
 * one button, gone by itself — it never interrupts an approval. */
function buildRitual(actions: ViewActions): ViewHost {
  const title = h("div", { class: "title" });
  const body = h("div", { class: "dim ritual-body" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" },
    card("teal", stack(116, 16, title, body, row)));
  let built = "";
  return {
    el,
    sync() {
      const r = State.ritual;
      if (!r) return;
      const heading = r.kind === "break" ? t("Time for a break") : t("Milestone");
      const text = r.kind === "break"
        ? t("The agents have been at it for {count} minutes.", { count: r.minutes })
        : r.kind === "words"
          ? t("{count} words today", { count: r.count })
          : t("{count} days in a row", { count: r.count });
      const key = `${heading}|${text}`;
      if (key === built) return;
      built = key;
      title.textContent = heading;
      body.textContent = text;
      clear(row);
      row.append(btn(tl("Take a breath"), "primary", () => {
        State.ritual = null;
        actions.collapse();
      }));
    },
  };
}

// ── Error ─────────────────────────────────────────────────────────────────────

function buildError(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const detail = h("div", { class: "detail" });
  const row = h("div", { class: "actions" },
    btn(tl("Retry"), "primary", () => actions.setView(State.defaultView())),
    btn(tl("Open in n8n"), "secondary", () => actions.openUrl("")),
  );
  const el = h("div", { class: "view" }, card("pink", stack(116, 16, who, title, detail, row)));
  return {
    el,
    sync() {
      const task = State.focusTask;
      clear(who);
      // agentWho already shows an agent's name: its label is just the kind.
      const whoLabel = task?.source === "n8n" ? "n8n" : task?.source === "agent" ? t("Agent") : "Claude Code";
      who.append(agentWho(task, whoLabel));
      title.textContent = task?.source === "n8n" ? t("Workflow stopped.") : t("Session stopped on an error.");
      detail.textContent = (task && lastTextStep(task.steps)) ?? t("No detail available.");
    },
  };
}

// ── Finished ──────────────────────────────────────────────────────────────────

function buildFinished(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title one-line" });
  const open = btn(tl("Open terminal"), "primary", () => actions.openTerminal());
  const row = h("div", { class: "actions" },
    open,
    btn(tl("OK"), "secondary", () => actions.collapse()),
  );
  const el = h("div", { class: "view" }, card("teal", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      const agent = State.focusTask?.source === "agent";
      who.append(agentWho(State.focusTask, agent ? t("finished") : t("Claude Code finished")));
      // The final message, else the last step that is not a diff (FinishedView).
      const task = State.focusTask;
      title.textContent = task?.finalLine || (task && lastTextStep(task.steps)) || t("Session finished");
      // Sessions from the Claude desktop app live there, not in a terminal.
      const label = task?.id === "agent_claude-desktop" ? t("Open Claude") : t("Open terminal");
      const span = open.firstElementChild as HTMLElement;
      if (span.textContent !== label) span.textContent = label;
    },
  };
}

// ── Note ──────────────────────────────────────────────────────────────────────

function buildNote(): ViewHost {
  const title = h("div", { class: "title" });
  const el = h("div", { class: "view" }, card(null, h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title)));
  return {
    el,
    sync() {
      title.textContent = State.noteMessage ?? "";
    },
  };
}

// ── In-island settings ────────────────────────────────────────────────────────

function buildSettings(actions: ViewActions): ViewHost {
  const soundSwitch = h("button", { class: "switch", onclick: () => actions.toggleSound() });
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    oninput: (e: Event) => actions.setVolume(Number((e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  const autoLabel = h("span", {});
  const segButtons = [10, 15, 30].map((s) =>
    h("button", { onclick: () => actions.setAutoClose(s) }, `${s}s`),
  );
  const claudeBadge = h("span", { class: "status-badge" });
  const apiBadge = h("span", { class: "status-badge" });

  const rows = h(
    "div",
    { class: "settings-rows" },
    h("div", { class: "settings-row" }, soundSwitch, h("span", { text: tl("Sound") }), volume),
    h(
      "div",
      { class: "settings-row" },
      svg(ICONS.timer, 12),
      autoLabel,
      h("div", { class: "seg" }, ...segButtons),
    ),
    h(
      "div",
      { class: "settings-row", style: "gap:14px" },
      claudeBadge,
      apiBadge,
      h("div", { class: "grow" }),
      h("button", {
        class: "link-btn",
        style: "color:#8e939c;font-size:11.5px",
        text: tl("Settings…"),
        onclick: () => actions.openSettingsWindow(),
      }),
    ),
  );

  const el = h("div", { class: "view" },
    card(null, h("div", { class: "stack", style: "padding:14px 16px 14px 84px" }, rows)));

  return {
    el,
    sync() {
      const s = State.settings;
      soundSwitch.classList.toggle("on", s.soundEnabled);
      volume.value = String(s.soundVolume);
      volume.style.opacity = s.soundEnabled ? "1" : "0.4";
      autoLabel.textContent = t("Auto-close · {seconds}s", { seconds: Math.round(s.autoCloseInterval) });
      segButtons.forEach((b, i) => b.classList.toggle("on", s.autoCloseInterval === [10, 15, 30][i]));
      clear(claudeBadge);
      claudeBadge.append(
        dot(s.hooksInstalled ? "#22C55E" : "#F4505E", 6),
        h("span", { text: "Claude Code" }),
      );
      clear(apiBadge);
      apiBadge.append(dot("#F4505E", 6), h("span", { text: "API" }));
    },
  };
}

// ── Placeholders filled in later stages ───────────────────────────────────────

function buildPlaceholder(title: Msg, sub: string): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px" },
    h("div", { class: "title", text: title }),
    h("div", { class: "sub", text: sub }),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export function buildViews(
  actions: ViewActions,
  onChatHeightChange: () => void,
): Map<IslandViewName, ViewHost> {
  const map = new Map<IslandViewName, ViewHost>();
  // The widget deck (views/deck.ts) is what the island opens on; the old
  // overview of slides is gone from the Miku build.
  map.set("overview", buildDeck(actions));
  map.set("empty", buildEmpty(actions));
  map.set("error", buildError(actions));
  map.set("finished", buildFinished(actions));
  map.set("ritual", buildRitual(actions));
  map.set("note", buildNote());
  map.set("settings", buildSettings(actions));
  map.set("prompt", buildPrompt(onChatHeightChange));
  map.set("recap", buildRecap(actions));
  map.set("wardrobe", buildWardrobe(actions));
  map.set("update", buildUpdate());
  // Not in the Windows v1: sending a file by email, window attach + web result.
  map.set("mail", buildPlaceholder(tl("Sending by email isn't in this version."), ""));
  map.set("searching", buildPlaceholder(tl("Claude is searching…"), ""));
  map.set("result", buildPlaceholder(tl("Result"), ""));
  return map;
}
