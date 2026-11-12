// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { Ticker } from "./ticker";
import { State, type AgentTask } from "../core/state";
import { washRGBA, type IslandViewName, type Wash } from "../core/layout";
import { buildPrompt } from "./chat";
import { buildChoose, buildUpload, buildUploading } from "./upload";
import { renderIntegrationCard, type IntegrationCardHooks } from "./integrations";
import { highlightRow, listRows, openRow } from "./github";
import { MAX_DECLARED, declarablePills, pillDefinition, sanitizeDeclared, sessionSubtitle } from "../core/pills";
import { pillColor } from "../core/pill-colors";
import {
  PlanCard, buildPlanPill, claudePillVisible, codexPillVisible, planCardOpen, refreshCodexPlanUsage,
} from "./usage";
import { buildDiffCard } from "./diff";
import { lastTextStep } from "../core/diff";
import { Bridge } from "../core/bridge";
import { buildRecap } from "./recap";
import { buildWardrobe } from "./wardrobe";
import { buildUpdate } from "./update";
import { buildWhatsNew } from "./whatsnew";
import { buildSpotifyCard } from "./spotify";
import { SPOTIFY_ID } from "../core/spotify";
import { buildWhatsAppCard } from "./whatsapp";
import { buildSystemCard, SYSTEM_ID } from "./system";
import { WHATSAPP_ID } from "../core/whatsapp";
import { MAIL_ID } from "../core/mail";
import { buildMailCard } from "./mail";
import type { Outfit, OutfitSelection, VariantSelection } from "../mochi/wardrobe";
import type { MikuVariantId } from "../mochi/variants";
import { language, t, tn, tl, type Msg } from "../i18n/i18n";
import type { ViewCommand } from "../island/shortcuts";

export interface ViewActions {
  setView(v: IslandViewName): void;
  /** "Cancel" on a dropped file: forgets it and goes back home. */
  cancelDrop(): void;
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

function card(wash: Wash, ...children: (Node | string)[]): HTMLElement {
  const el = h("div", { class: wash ? "card wash" : "card" }, ...children);
  if (wash) el.style.setProperty("--wash", washRGBA(wash));
  return el;
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
  const tabDrop = h("button", { class: "tab", title: tl("Drop"), onclick: () => go("upload") }, svg(ICONS.plus, 16));

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

  return {
    el,
    sync() {
      const v = State.view;
      tabHome.classList.toggle("on", v === "overview" || v === "empty");
      tabChat.classList.toggle("on", v === "prompt");
      tabDrop.classList.toggle("on", v === "upload");
      gearBtn.classList.toggle("on", v === "settings");
      clear(gearBtn);
      gearBtn.append(v === "settings" ? svg(ICONS.gearFill, 18) : svg(ICONS.gearLine, 18, { stroke: 1.6 }));
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerLine : ICONS.speakerSlashLine, 18, { stroke: 1.6 }));
      closeBtn.style.display = State.pendingApproval ? "none" : "";
      pager.style.display = v === "overview" ? "" : "none";
      if (v === "overview") syncPager();
      syncPlanPills();
      el.style.opacity = v === "confused" ? "0" : "1";
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

function buildOverview(actions: ViewActions): ViewHost {
  /** The diff open in the left card (a FileDiff id), as activeDiffId on macOS. */
  let activeDiffId: number | null = null;
  const closeDiff = () => {
    if (activeDiffId == null) return;
    activeDiffId = null;
    State.notify();
  };
  const ticker = new Ticker((diffId) => {
    actions.blip();
    activeDiffId = diffId;
    State.notify();
  });
  const who = h("div", { class: "who" });
  const tickerBody = h("div", { class: "card-body" }, who, ticker.el);
  const leftBody = h("div", { class: "left-body" });
  const jump = h(
    "button",
    { class: "icon-btn jump", title: tl("Open"), onclick: () => actions.openTarget() },
    svg(ICONS.arrowUpRight, 12),
  );
  const left = card(null, leftBody, jump);
  // Edit: every pill that can have a slide, each switched on or off here.
  const editPanel = h("div", { class: "slide-edit" });
  // Opened from a plan pill in the header: stands in for the left card.
  const plan = new PlanCard();
  let planTimer: number | null = null;
  // Spotify's card and pill are kept and updated in place: the progress bar
  // runs on, and a slider being dragged must not be rebuilt under the pointer.
  const spotifyCard = buildSpotifyCard();
  // WhatsApp's card too: its reply field keeps the draft and the keyboard while messages arrive.
  // Mail's card too (classic Outlook): the search field keeps its text and the keyboard.
  const mailCard = buildMailCard({ keyboard: (on) => actions.keyboard(on) });
  // The System pill's card: its numbers change every three seconds, so it is
  // kept and updated in place rather than rebuilt.
  const systemCard = buildSystemCard();
  const whatsappCard = buildWhatsAppCard({
    openSettings: () => actions.openSettingsWindow(),
    keyboard: (on) => actions.keyboard(on),
    holdOpen: (on) => actions.holdOpen(on),
  });

  const el = h("div", { class: "view overview" }, h("div", { class: "left" }, left));

  let detailOpen = false;
  let lastFocus: string | null = null;
  let mode: "ticker" | "card" | "plan" | "diff" | "spotify" | "whatsapp" | "mail" | "system" | "edit" | null = null;
  let cardKey = "";
  /** The list row highlighted at the last sync, to scroll only when it moves. */
  let shownSelection: number | null = null;

  // Leaving the overview or folding the island closes the diff, as on macOS,
  // and ends choosing the slides.
  State.subscribe(() => {
    if (State.view !== "overview" || State.mode !== "expanded") {
      activeDiffId = null;
      slideEditing = false;
    }
  });
  // Escape steps back out of the diff, or out of Edit, before it closes the island.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || State.view !== "overview") return;
      if (slideEditing) {
        e.stopImmediatePropagation();
        slideEditing = false;
        State.notify();
        return;
      }
      if (activeDiffId == null) return;
      e.stopImmediatePropagation();
      closeDiff();
    },
    true,
  );

  // ── Slides: swipe, drag or ←/→ to the next pill ──
  /** Plays the slide arriving from `dir` (1: from the right). */
  function slideIn(dir: number, cls = "slide") {
    leftBody.classList.remove("slide-next", "slide-prev", "edge-next", "edge-prev");
    void leftBody.offsetWidth; // restarts the animation
    leftBody.classList.add(`${cls === "edge" ? "edge" : "slide"}-${dir > 0 ? "next" : "prev"}`);
  }
  function go(dir: 1 | -1) {
    if (!stepSlide(actions, dir)) slideIn(dir, "edge");
  }

  // A trackpad's sideways swipe (or Shift + wheel): one slide per gesture.
  let wheelAcc = 0;
  let wheelAt = 0;
  let wheelLock = 0;
  left.addEventListener("wheel", (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!d || slideEditing) return;
    e.preventDefault();
    const now = performance.now();
    if (now - wheelAt > 220) wheelAcc = 0;
    wheelAt = now;
    if (now < wheelLock) return;
    wheelAcc += d;
    if (Math.abs(wheelAcc) < 40) return;
    go(wheelAcc > 0 ? 1 : -1);
    wheelAcc = 0;
    wheelLock = now + 450;
  }, { passive: false });

  // Dragging the stage sideways, like a phone. Never from a control, nor from
  // Miku's own spot (pressing her there picks her up to carry her out).
  const MIKU_ZONE = 108;
  const SWIPE = 60;
  let drag: { x: number; dx: number } | null = null;
  left.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || slideEditing) return;
    if (e.clientX - left.getBoundingClientRect().left < MIKU_ZONE) return;
    if ((e.target as Element).closest("button, a, input, textarea, select, [contenteditable], [role=slider]")) return;
    drag = { x: e.clientX, dx: 0 };
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.x;
    if (Math.abs(drag.dx) < 6) return;
    leftBody.style.transition = "none";
    leftBody.style.transform = `translateX(${drag.dx * 0.35}px)`;
  });
  window.addEventListener("pointerup", () => {
    if (!drag) return;
    const dx = drag.dx;
    drag = null;
    leftBody.style.transition = "";
    leftBody.style.transform = "";
    if (Math.abs(dx) >= SWIPE) go(dx < 0 ? 1 : -1);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (State.view !== "overview" || State.mode !== "expanded" || slideEditing) return;
    if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
    if ((e.target as Element | null)?.closest?.("input, textarea, [contenteditable]")) return;
    e.preventDefault();
    go(e.key === "ArrowRight" ? 1 : -1);
  });

  function renderEdit() {
    clear(editPanel);
    const d = sanitizeDeclared(State.settings, State.os);
    const main = pillDefinition(d.mainPill);
    // The main pill first, then the slides that are on (in their order), then the rest.
    const rest = declarablePills(State.os).filter((p) => p.id !== d.mainPill);
    const rank = (id: string) => (d.activeIntegrations.includes(id) ? d.activeIntegrations.indexOf(id) : MAX_DECLARED);
    const defs = [...(main ? [main] : []), ...rest.sort((a, b) => rank(a.id) - rank(b.id))];
    const note = h("div", { class: "slide-edit-note", text: `${d.activeIntegrations.length + 1}/${MAX_DECLARED + 1}` });
    const grid = h("div", { class: "slide-edit-grid" });
    for (const def of defs) {
      const isMain = def.id === d.mainPill;
      const on = isMain || d.activeIntegrations.includes(def.id);
      const chip = h("button", {
        class: `slide-chip${on ? " on" : ""}${isMain ? " main" : ""}`,
        title: def.name,
        onclick: () => {
          // The main pill always has its slide: it is changed in Settings.
          if (isMain) return;
          if (!on && d.activeIntegrations.length >= MAX_DECLARED) {
            note.textContent = t("All {max} slots are in use. Turn one off to make room for {name}.", { max: MAX_DECLARED, name: def.name });
            note.classList.add("warn");
            return;
          }
          actions.toggleSlide(def.id);
        },
      }, h("i"), h("span", { text: def.name }));
      chip.style.setProperty("--pill", pillColor(def.id, def.color, State.settings.pillColors));
      grid.append(chip);
    }
    editPanel.append(grid, note);
  }

  const hooks: IntegrationCardHooks = {
    get detailOpen() {
      return detailOpen;
    },
    openDetail() {
      detailOpen = true;
      cardKey = "";
      State.notify();
    },
    closeDetail() {
      detailOpen = false;
      cardKey = "";
      State.notify();
    },
    openSettings: () => actions.openSettingsWindow(),
  };

  /** The countdowns move every 30 s while a card is open, and only then. */
  function syncPlanTimer(open: boolean) {
    const stop = () => {
      if (planTimer != null) window.clearInterval(planTimer);
      planTimer = null;
    };
    if (!open) return stop();
    if (planTimer != null) return;
    planTimer = window.setInterval(() => {
      if (planCardOpen() && State.mode === "expanded") State.notify();
      else stop();
    }, 30_000);
  }

  return {
    el,
    tick(nowMs: number) {
      if (mode !== "ticker") return false;
      ticker.tick(nowMs);
      return ticker.animating;
    },
    command(command) {
      if (command === "openSelection") {
        // Ctrl+O: what a click on the highlighted row does.
        if (mode !== "card" || State.cardSelection == null) return;
        openRow(listRows(leftBody)[State.cardSelection]);
        return;
      }
      // Ctrl+E (⌘E, islandToggleDiff): closes the diff that is open, else
      // opens the focused pill's latest edit.
      if (activeDiffId != null) {
        closeDiff();
        return;
      }
      const task = State.focusTask;
      const diffs = task ? State.sessionDiffs.get(task.id) : undefined;
      const last = diffs?.[diffs.length - 1];
      if (last?.id == null) return;
      activeDiffId = last.id;
      State.notify();
    },
    sync() {
      const task = State.focusTask;
      if (task?.id !== lastFocus) {
        const from = State.tasks.findIndex((x) => x.id === lastFocus);
        const to = State.tasks.findIndex((x) => x.id === task?.id);
        if (from >= 0 && to >= 0) slideIn(to > from ? 1 : -1);
        lastFocus = task?.id ?? null;
        detailOpen = false;
        activeDiffId = null;
        cardKey = "";
        mode = null;
      }

      if (slideEditing) {
        const key = `edit~${State.settings.mainPill}~${State.settings.activeIntegrations.join(",")}~${language()}`;
        if (mode !== "edit" || key !== cardKey) {
          mode = "edit";
          cardKey = key;
          renderEdit();
          clear(leftBody);
          leftBody.append(editPanel);
        }
        jump.style.display = "none";
        State.cardItemCount = 0;
        return;
      }
      if (mode === "edit") {
        mode = null;
        cardKey = "";
      }

      // A workspace or agent pill with a live session keeps the ticker; every
      // other pill shows its own card, exactly like IntegrationCardView.
      const sessionActive = task != null && hasSessionTicker(task);

      const planOpen = planCardOpen();
      if (mode === "plan" && !planOpen) {
        mode = null;
        cardKey = "";
      }
      syncPlanTimer(planOpen);

      // A diff that has since been dropped (cap, expiry, session end) just closes.
      const diff = task && activeDiffId != null ? State.findDiff(task.id, activeDiffId) : null;
      if (!diff) activeDiffId = null;

      if (planOpen) {
        if (mode !== "plan") {
          clear(leftBody);
          leftBody.append(plan.el);
          mode = "plan";
        }
        plan.sync();
      } else if (task && diff) {
        const key = `diff~${task.id}~${diff.id}`;
        if (key !== cardKey) {
          cardKey = key;
          mode = "diff";
          clear(leftBody);
          leftBody.append(buildDiffCard(diff, {
            dismiss: () => {
              actions.blip();
              closeDiff();
            },
            open: (path) => void Bridge.openFileInVSCode(path),
          }));
        }
      } else if (task && sessionActive) {
        if (mode !== "ticker") {
          clear(leftBody);
          leftBody.append(tickerBody);
          mode = "ticker";
          cardKey = "";
        }
        clear(who);
        // The agent's name is already the pill's: the label says what kind of
        // pill it is, as on the Mac (PillDefinition.sessionSubtitle).
        who.append(
          dot(task.color, 7),
          h("span", { class: "name", text: task.name }),
          h("span", { class: "tool", text: t(sessionSubtitle(task.id)) }),
        );
        if (task.steps.length > 1) {
          who.append(h("span", {
            class: "count",
            text: `${Math.min(task.stepIndex + 1, task.steps.length)}/${task.steps.length}`,
          }));
        }
        ticker.sync(task);
      } else if (task && task.id === SPOTIFY_ID) {
        // Its own card for every state: playing, idle, not installed.
        if (mode !== "spotify") {
          clear(leftBody);
          leftBody.append(spotifyCard.el);
          mode = "spotify";
          cardKey = "";
        }
        spotifyCard.sync();
      } else if (task && task.id === SYSTEM_ID) {
        // The gauges are redrawn in place: the card's own copy of the reading
        // is what changed, three seconds at a time.
        if (mode !== "system") {
          clear(leftBody);
          leftBody.append(systemCard.el);
          mode = "system";
          cardKey = "";
        }
        systemCard.sync();
      } else if (task && task.id === MAIL_ID) {
        if (mode !== "mail") {
          clear(leftBody);
          leftBody.append(mailCard.el);
          mode = "mail";
          cardKey = "";
        }
        mailCard.sync();
      } else if (task && task.id === WHATSAPP_ID) {
        // Its own card in every state: not linked, no message, conversations, one open.
        if (mode !== "whatsapp") {
          clear(leftBody);
          leftBody.append(whatsappCard.el);
          mode = "whatsapp";
          cardKey = "";
        }
        whatsappCard.sync();
      } else if (task) {
        const info = State.integrations[task.id];
        const key = [
          language(), task.id, task.color, detailOpen, task.state, task.steps.join("|"),
          info?.loaded, info?.error, info?.configured,
          JSON.stringify(info?.data ?? {}),
        ].join("~");
        if (key !== cardKey) {
          cardKey = key;
          mode = "card";
          clear(leftBody);
          leftBody.append(renderIntegrationCard(task, hooks));
        }
      }

      jump.style.display = detailOpen || mode === "plan" || mode === "diff" ? "none" : "";

      // Ctrl+↓ Ctrl+↑ walk the open GitHub list (cardItemCount / cardSelection).
      const rows = mode === "card" ? listRows(leftBody) : [];
      State.cardItemCount = rows.length;
      if (State.cardSelection != null && State.cardSelection >= rows.length) State.cardSelection = null;
      highlightRow(rows, State.cardSelection, State.cardSelection !== shownSelection);
      shownSelection = State.cardSelection;

    },
  };
}

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

// ── Approval ──────────────────────────────────────────────────────────────────

/** How long a fresh permission card ignores clicks on its buttons. */
const CLICK_GUARD_MS = 600;

/**
 * The ⌃ in the corner of a waiting card: folds the island to its compact size
 * and leaves the request waiting — nothing is answered (Mac #290). Opening the
 * island again brings the card back.
 */
function foldButton(actions: ViewActions): HTMLElement {
  return h(
    "button",
    { class: "icon-btn fold", title: tl("Later — keep it waiting"), onclick: () => actions.foldApproval() },
    svg(ICONS.chevronUp, 8, { stroke: 2.4 }),
  );
}

function buildApproval(actions: ViewActions): ViewHost {
  const who = h("div");
  const code = h("div", { class: "code" });
  const row = h("div", { class: "actions" });
  const more = h("div", { class: "queued-more" });
  const cardEl = card("amber", stack(116, 16, who, code, row), foldButton(actions), more);
  // Two ghost cards that fan out behind this one while a queue waits: real
  // siblings, so they never cross the card's own face.
  const g1 = h("div", { class: "ghost" });
  const g2 = h("div", { class: "ghost" });
  const wrap = h("div", { class: "approval-stack" }, g2, g1, cardEl);
  const el = h("div", { class: "view" }, wrap);
  let rowKey = "";
  // The card pops up under a cursor that was busy with something else: a click
  // meant for the window underneath must not land on Allow. Clicks in the first
  // moments after a new request appears are ignored.
  let shownFor: string | null = null;
  let shownAt = 0;
  const guarded = (d: "allow" | "deny" | "remember") => () => {
    if (performance.now() - shownAt < CLICK_GUARD_MS) return;
    if (d === "remember") actions.rememberApproval();
    else actions.decide(d);
  };
  return {
    el,
    sync() {
      const req = State.pendingApproval?.requestId ?? null;
      if (req !== shownFor) {
        shownFor = req;
        shownAt = performance.now();
      }
      clear(who);
      who.append(agentWho(State.focusTask, t("needs permission")));
      // The whole point of approving here rather than in the terminal: this line
      // is the command, the file path or the URL being authorised, not just the
      // name of the tool asking.
      code.textContent = State.pendingApproval?.command || State.pendingApproval?.tool || "…";
      // The queue behind this one reads as a stack, not as a card that keeps
      // changing its mind.
      const extra = State.approvalQueue.length;
      wrap.classList.toggle("queued", extra > 0);
      clear(more);
      if (extra > 0) more.textContent = tn("one more waiting", "{count} more waiting", extra);
      // Two buttons, built once. Rebuilding them between a mouse-down and a
      // mouse-up would swallow the click, and there is nothing left to vary:
      // "Always" is gone until the remembered-rules list exists to back it.
      if (rowKey === "built") return;
      rowKey = "built";
      clear(row);
      row.append(
        btn(tl("Deny"), "secondary", guarded("deny"), "N"),
        btn(tl("Always"), "secondary", guarded("remember"), "A"),
        btn(tl("Allow"), "primary", guarded("allow"), "Y"),
      );
    },
  };
}

// ── Ritual ────────────────────────────────────────────────────────────────────

/** The ritual card: a break worth taking, a milestone worth a nod. One line,
 * one button, gone by itself — it never interrupts an approval. */
function buildRitual(actions: ViewActions): ViewHost {
  const title = h("div", { class: "title" });
  const body = h("div", { class: "dim ritual-body" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" },
    card("cyan", stack(116, 16, title, body, row)));
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

// ── Question ──────────────────────────────────────────────────────────────────

function buildQuestion(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title question-text" });
  const row = h("div", { class: "actions options" });
  const fold = foldButton(actions);
  const el = h("div", { class: "view" }, card("cyan", stack(116, 16, who, title, row), fold));

  // Where we are in the request on screen: which question, what is answered so
  // far, and what is ticked in a pick-several question.
  let requestId = "";
  let index = 0;
  let answers: Record<string, string | string[]> = {};
  let picked = new Set<string>();
  // The buttons are only rebuilt when what they show changes: rebuilding them
  // between a mouse-down and a mouse-up would swallow the click.
  let rowKey = "";

  const next = (question: string, answer: string | string[], total: number) => {
    answers[question] = answer;
    picked = new Set();
    index += 1;
    if (index >= total) actions.answer(answers);
    else State.notify();
  };

  return {
    el,
    sync() {
      const questions = State.pendingApproval?.questions;
      clear(who);
      // Only a request that is waiting can be folded away and come back.
      fold.style.display = State.pendingApproval ? "" : "none";

      // A question that arrived as a notification has nothing to pick from.
      if (!questions) {
        who.append(agentWho(State.focusTask, t("is asking a question")));
        const task = State.focusTask;
        title.textContent = (task && lastTextStep(task.steps)) ?? t("Claude needs an answer.");
        if (rowKey !== "terminal") {
          rowKey = "terminal";
          clear(row);
          row.append(h("div", { class: "sub", text: tl("Answer it in your terminal.") }));
        }
        return;
      }

      if (State.pendingApproval!.requestId !== requestId) {
        requestId = State.pendingApproval!.requestId;
        index = 0;
        answers = {};
        picked = new Set();
      }
      const q = questions[Math.min(index, questions.length - 1)];
      const asking = questions.length > 1
        ? t("is asking ({index} of {total})", { index: index + 1, total: questions.length })
        : t("is asking");
      who.append(agentWho(State.focusTask, asking));
      title.textContent = q.question;
      title.title = q.question;

      const key = `${requestId}:${index}:${[...picked].join("|")}`;
      if (rowKey === key) return;
      rowKey = key;
      clear(row);
      for (const option of q.options) {
        const on = picked.has(option.label);
        const button = btn(option.label, on ? "primary" : "secondary", () => {
          if (!q.multiSelect) {
            next(q.question, option.label, questions.length);
            return;
          }
          if (on) picked.delete(option.label);
          else picked.add(option.label);
          State.notify();
        });
        if (option.description) button.title = option.description;
        row.append(button);
      }
      if (q.multiSelect) {
        const done = btn(tl("Done"), "primary", () => {
          if (picked.size > 0) next(q.question, [...picked], questions.length);
        });
        if (picked.size === 0) done.classList.add("off");
        row.append(done);
      }
      row.append(
        h("button", {
          class: "link-btn",
          style: "color:#8e939c",
          text: tl("Answer in terminal"),
          onclick: () => actions.answerInTerminal(),
        }),
      );
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
  const el = h("div", { class: "view" }, card("red", stack(116, 16, who, title, detail, row)));
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
  const el = h("div", { class: "view" }, card("green", stack(116, 16, who, title, row)));
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

// ── Confused ──────────────────────────────────────────────────────────────────

function buildConfused(): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 128px" },
    h("div", { class: "title", text: tl("Too many hits at once.") }),
    h("div", { class: "sub", text: tl("Give me a sec — back to work in three seconds.") }),
  );
  return { el: h("div", { class: "view" }, card("pink", body)), sync() {} };
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
  map.set("overview", buildOverview(actions));
  map.set("empty", buildEmpty(actions));
  map.set("approval", buildApproval(actions));
  map.set("question", buildQuestion(actions));
  map.set("error", buildError(actions));
  map.set("finished", buildFinished(actions));
  map.set("confused", buildConfused());
  map.set("ritual", buildRitual(actions));
  map.set("note", buildNote());
  map.set("settings", buildSettings(actions));
  map.set("prompt", buildPrompt(onChatHeightChange));
  map.set("upload", buildUpload());
  map.set("uploading", buildUploading());
  map.set("choose", buildChoose(actions));
  map.set("recap", buildRecap(actions));
  map.set("wardrobe", buildWardrobe(actions));
  map.set("update", buildUpdate());
  map.set("whatsNew", buildWhatsNew());
  // Not in the Windows v1: sending a file by email, window attach + web result.
  map.set("mail", buildPlaceholder(tl("Sending by email isn't in this version."), ""));
  map.set("searching", buildPlaceholder(tl("Claude is searching…"), ""));
  map.set("result", buildPlaceholder(tl("Result"), ""));
  return map;
}
