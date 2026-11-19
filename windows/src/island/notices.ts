// What the closed island tells you without opening (docs/mockups/notch-capsule.png,
// docs/mockups/notif-incoming.png, docs/mockups/notch-prototype.html):
//
// - A notice card grows out of the capsule when something arrives — a WhatsApp
//   message (reply right there), an agent that finished — and holds until the
//   user acts: a button on it, or the island opened. Nothing folds on its own.
// - Whatever is still unseen afterwards hangs under the capsule: Miku on a thread
//   with a small sign — an agent asking (folded card), unread WhatsApp, an agent
//   that finished. A click opens it.
//
// No DOM of the island's own is touched here: these two live in the island's
// root, beside it, and the island asks how much room they need (window size,
// click area).

import { Bridge } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type ApprovalInfo } from "../core/state";
import { lastTextStep } from "../core/diff";
import type { ViewActions } from "../views/views";
import { WhatsApp, preview, type WaConversation } from "../core/whatsapp";
import { CHIBI_H, CHIBI_W, drawChibi, type ChibiPose } from "../mochi/chibi";
import { PING_TOP, drawPing } from "../mochi/ping";
import { parseVariant, resolveVariantNow } from "../mochi/wardrobe";
import { appIcon } from "../views/appicons";
import { h, svg } from "../views/dom";
import { ensureJapaneseTokenizer, languageOfLines, romanizeMixed, scriptOf } from "../lyrics/romanize";
import { language, t, tn } from "../i18n/i18n";
import { ctx2d } from "../core/canvas";
import * as NoticeHistory from "./history";
import { Updates } from "./update";
import { percent } from "../core/update";
import { WHATS_NEW_ICONS } from "../whats-new/icons";
import { iconName, localized, type WhatsNewRelease } from "../whats-new/whats-new";

/** Pink is the update's colour, as on the deck's update button. */
const UPDATE_COLOR = "#e8457c";

/** How long the fold countdown runs once the pointer is off the notch. */
export const NOTICE_MS = 6000;
/** Room the two need, in CSS px (the island adds them to its window and hit area). */
export const NOTICE_W = 470;
export const NOTICE_H = 148;
/** A question card: room for its text and two rows of answers. */
export const QUESTION_H = 190;
/** How long a fresh permission or question card ignores clicks on its buttons:
 *  it comes down under a cursor that was busy with something else. */
const CLICK_GUARD_MS = 600;
/** The permission card's yellow, as the mockup's (docs/mockups/notch-prototype.html). */
const ASK_COLOR = "#ffd36b";
export const HANG_W = 320;
export const HANG_H = 96;

export interface NoticeHost {
  /** Opens the island on the waiting card (approval or question). */
  openApproval(): void;
  /** Opens the island's deck on the Agents page, on this agent. */
  openAgents(agentId?: string): void;
  /** The room changed: window size and click area follow. */
  relayout(): void;
  /** What a permission or question card answers with (the island's own actions). */
  request: Pick<ViewActions, "decide" | "rememberApproval" | "answer" | "answerInTerminal" | "openTerminal">;
}

/** What hangs under the capsule: the most important unseen thing. */
interface Hang {
  pose: ChibiPose;
  color: string;
  html: HTMLElement[];
  pulse: boolean;
  /** What the sign's content is made of: the same key measures the same, so
   *  the DOM is rebuilt and re-measured only when it changes. */
  key: string;
  open(): void;
}

export class Notices {
  readonly noticeEl: HTMLElement;
  readonly hangEl: HTMLElement;
  private noticeMiku: HTMLCanvasElement;
  private noticeBody: HTMLElement;
  private hangMiku: HTMLCanvasElement;
  private hangSign: HTMLElement;
  private noticePose: ChibiPose = "idle";
  /** A message plays the headset ping (mochi/ping.ts) from when it arrived. */
  private noticePing = false;
  private noticeAt = 0;
  private hangPose: ChibiPose = "idle";
  private raf: number | null = null;
  private readonly started = performance.now();
  /** The agent that finished while the island was closed, until it is seen. */
  private finished: { id: string; name: string; step: string } | null = null;
  private lastStates = new Map<string, string>();
  private shownHang = false;
  /** LINE / Discord messages seen as toasts and not opened yet. */
  private pcUnread: { line: string[]; discord: string[] } = { line: [], discord: [] };
  /** The chat app whose card is up, while it is up (pcRead folds it). */
  private noticeChatApp: "line" | "discord" | null = null;
  private shownNotice = false;
  /** The permission or question on the card (its requestId), while it is up. */
  private requestShown: string | null = null;
  /** The request "Later" folded away: it hangs under the capsule until clicked. */
  private requestFolded: string | null = null;
  private requestAt = 0;
  /** A question's progress: which one, what is answered, what is ticked. */
  private quiz = { id: "", index: 0, answers: {} as Record<string, string | string[]>, picked: new Set<string>() };
  private lastHangWidth = 0;
  /** What the hanging sign was last built from (see Hang.key). */
  private hangKey = "";
  /** The pointer on the card, and on the notch: the card is held while either
   *  is true, and the fold countdown runs outside. The notch side comes from
   *  Rust's `closed-hover` heartbeat, which repeats every ≤250 ms while the
   *  pointer rests on the folded window and stops the moment it leaves — its
   *  absence for a beat and a half is how "left" is known. */
  private hoveringCard = false;
  private insideNotch = false;
  private foldTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  /** The card up is the update's: it follows Updates.status while it is up. */
  private updateShown = false;
  /** What the update card was built for; its buttons are rebuilt only when it changes. */
  private updateKey = "";
  private updateFill: HTMLElement | null = null;
  private updateLine: HTMLElement | null = null;

  constructor(private host: NoticeHost) {
    this.noticeMiku = h("canvas", { class: "nt-miku" }) as HTMLCanvasElement;
    this.noticeBody = h("div", { class: "nt-body" });
    // Miku stands on the island's floor, outside the glass card.
    this.noticeEl = h("div", { class: "nt-card" }, h("div", { class: "nt-floor" }, this.noticeMiku), this.noticeBody);
    this.noticeEl.addEventListener("mouseenter", () => {
      this.hoveringCard = true;
      this.resyncFold();
    });
    this.noticeEl.addEventListener("mouseleave", () => {
      this.hoveringCard = false;
      this.resyncFold();
    });
    // A press inside must not reach the island's own press handler (it would open it).
    this.noticeEl.addEventListener("mousedown", (e) => e.stopPropagation());

    this.hangMiku = h("canvas", { class: "hg-miku" }) as HTMLCanvasElement;
    this.hangSign = h("div", { class: "hg-sign" });
    this.hangEl = h("div", { class: "hg" }, h("span", { class: "hg-thread" }), this.hangMiku, this.hangSign);
    this.hangEl.addEventListener("mousedown", (e) => e.stopPropagation());
    this.hangEl.addEventListener("click", () => this.current()?.open());
  }

  /** Visible now: the window and the click area must hold them. */
  get noticeOn(): boolean {
    return this.shownNotice;
  }
  get hangOn(): boolean {
    return this.shownHang;
  }
  /** The card's height: a question needs more room than the rest. */
  get noticeH(): number {
    return this.noticeEl.classList.contains("tall") ? QUESTION_H : NOTICE_H;
  }
  /** The request on the card, if a permission or question card is up. */
  get requestOnCard(): string | null {
    return this.shownNotice ? this.requestShown : null;
  }

  // ── A permission or a question (docs/mockups/notch-prototype.html) ─────────

  /**
   * The waiting permission or question as a card that stays until it is
   * answered or folded with Later; null takes it down. `force` brings a folded
   * one back (a click on Miku under the capsule, the Go to alert shortcut).
   * Nothing is ever answered without a click on its buttons.
   */
  request(req: ApprovalInfo | null, force: boolean) {
    if (!req) {
      this.requestFolded = null;
      if (this.requestShown != null) {
        this.requestShown = null;
        if (this.shownNotice) this.close();
      }
      return;
    }
    if (force) this.requestFolded = null;
    if (this.requestFolded === req.requestId) return;
    if (this.quiz.id !== req.requestId) this.quiz = { id: req.requestId, index: 0, answers: {}, picked: new Set() };
    if (this.requestShown !== req.requestId || !this.shownNotice) this.requestAt = performance.now();
    this.requestShown = req.requestId;
    this.renderRequest(req);
  }

  private renderRequest(req: ApprovalInfo) {
    const task = State.tasks.find((x) => x.id === req.pillId) ?? null;
    const guard = (act: () => void) => () => {
      if (performance.now() - this.requestAt >= CLICK_GUARD_MS) act();
    };
    const btn = (label: string, kind: "p" | "s", act: () => void, tip?: string) =>
      h("button", { class: `nt-btn ${kind}`, text: label, onclick: guard(act), ...(tip ? { title: tip } : {}) });
    const later = h("button", { class: "nt-link", text: t("Later"), title: t("Later — keep it waiting"), onclick: () => {
      this.requestFolded = req.requestId;
      this.requestShown = null;
      this.close();
    } });
    const agent = (label: string) => h("div", { class: "nt-who" },
      task ? h("span", { class: "app-ic dot", style: `--c:${task.color}` }) : null,
      h("span", { class: "nt-name", text: task?.name ?? t("Agent") }),
      h("span", { class: "nt-dim", text: label }));
    const queued = State.approvalQueue.length;
    const head = (icon: string, title: string, color: string) => h("div", { class: "nt-src", style: `color:${color}` },
      h("span", { text: `${icon} ${title}` }),
      h("span", { class: "nt-time", text: queued > 0 ? tn("one more waiting", "{count} more waiting", queued) : "" }));

    const questions = req.questions;
    if (!questions) {
      this.open(ASK_COLOR, "approval", [
        head("✋", t("Miku asks for permission"), ASK_COLOR),
        agent(t("needs permission")),
        // The point of answering here: the command, path or URL itself.
        h("div", { class: "nt-code", text: req.command || req.tool || "…", title: req.command || req.tool }),
        h("div", { class: "nt-acts" },
          btn(t("Allow"), "p", () => this.host.request.decide("allow")),
          btn(t("Deny"), "s", () => this.host.request.decide("deny")),
          // As the old card: the tool asks no more from now on; this one still waits for Allow.
          btn(t("Always"), "s", () => this.host.request.rememberApproval()),
          later),
      ], false, true);
      return;
    }

    const quiz = this.quiz;
    const q = questions[Math.min(quiz.index, questions.length - 1)];
    const next = (answer: string | string[]) => {
      quiz.answers[q.question] = answer;
      quiz.picked = new Set();
      quiz.index += 1;
      if (quiz.index >= questions.length) this.host.request.answer(quiz.answers);
      else this.renderRequest(req);
    };
    const options = q.options.map((option) => {
      const on = quiz.picked.has(option.label);
      return btn(on ? `✓ ${option.label}` : option.label, on ? "p" : "s", () => {
        if (!q.multiSelect) return next(option.label);
        if (on) quiz.picked.delete(option.label);
        else quiz.picked.add(option.label);
        this.renderRequest(req);
      }, option.description || undefined);
    });
    if (q.multiSelect) {
      const done = btn(t("Done"), "p", () => {
        if (quiz.picked.size > 0) next([...quiz.picked]);
      });
      if (quiz.picked.size === 0) done.disabled = true;
      options.push(done);
    }
    const asking = questions.length > 1
      ? t("is asking ({index} of {total})", { index: quiz.index + 1, total: questions.length })
      : t("is asking");
    this.open("#39c5bb", "question", [
      head("💬", t("Miku has a question"), "#39c5bb"),
      agent(asking),
      h("div", { class: "nt-msg nt-q", text: q.question, title: q.question }),
      h("div", { class: "nt-opts" }, ...options),
      h("div", { class: "nt-acts" },
        h("button", { class: "nt-link", text: t("Answer in terminal"), onclick: guard(() => this.host.request.answerInTerminal()) }),
        later),
    ], false, true, true);
  }

  /** An agent asks a question with nothing to pick from: it is answered in the terminal. */
  askedInTerminal(task: { name: string; color: string; steps: readonly string[] } | null) {
    const ok = h("button", { class: "nt-btn s", text: t("OK") });
    ok.addEventListener("click", () => this.close());
    const open = h("button", { class: "nt-btn p", text: t("Open the terminal") });
    open.addEventListener("click", () => {
      this.host.request.openTerminal();
      this.close();
    });
    this.open("#39c5bb", "question", [
      h("div", { class: "nt-src", style: "color:#39c5bb" }, h("span", { text: `💬 ${t("Miku has a question")}` })),
      h("div", { class: "nt-who" },
        task ? h("span", { class: "app-ic dot", style: `--c:${task.color}` }) : null,
        h("span", { class: "nt-name", text: task?.name ?? t("Agent") }),
        h("span", { class: "nt-dim", text: t("is asking a question") })),
      h("div", { class: "nt-msg", text: (task && lastTextStep(task.steps)) ?? t("Claude needs an answer.") }),
      h("div", { class: "nt-acts" }, open, ok, h("span", { class: "nt-dim", text: t("Answer it in your terminal.") })),
    ]);
  }

  // ── Arrivals ───────────────────────────────────────────────────────────────

  /** A WhatsApp message arrived: its card, with a reply field. */
  whatsapp() {
    const conv = this.latestUnread();
    if (!conv) return;
    const last = conv.messages[conv.messages.length - 1];
    const input = h("input", { class: "nt-input", placeholder: t("Reply") + "…" }) as HTMLInputElement;
    const send = h("button", { class: "nt-btn p", text: t("Send") });
    const later = h("button", { class: "nt-btn s", text: t("Later") });
    const doSend = async () => {
      const text = input.value.trim();
      if (!text) return;
      send.setAttribute("disabled", "");
      // Sent only on this click (CLAUDE.md: never send without an explicit click).
      const ok = await Bridge.whatsappSend(conv.id, text);
      send.removeAttribute("disabled");
      if (ok) this.close();
    };
    send.addEventListener("click", () => void doSend());
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") void doSend();
    });
    // The field needs the keyboard: the island takes focus only while it is used.
    input.addEventListener("mousedown", () => {
      void Bridge.focusWindow(true);
      window.setTimeout(() => input.focus(), 60);
    });
    input.addEventListener("focus", () => void Bridge.focusWindow(true));
    input.addEventListener("blur", () => void Bridge.focusWindow(false));
    later.addEventListener("click", () => this.close());
    // The card folds away in a few seconds: the Notif page keeps what it said.
    void NoticeHistory.add({
      kind: "chat", app: "whatsapp", color: "#25d366",
      label: "WhatsApp", who: conv.name, text: last ? preview(last, conv.isGroup) : "",
    });
    this.open("#25d366", "approval", [
      source("whatsapp", "#25d366", "WhatsApp"),
      who("whatsapp", "#25d366", conv.name),
      h("div", { class: "nt-msg", text: last ? preview(last, conv.isGroup) : "" }),
      h("div", { class: "nt-acts" }, input, send, later),
    ], true);
  }

  /** A LINE or Discord toast Windows showed: its card, and a reply that opens the app. */
  async pcNotification(n: { app: string; title: string; body: string; target?: string | null }) {
    const app = n.app === "discord" ? "discord" : "line";
    const color = app === "discord" ? "#5865f2" : "#06c755";
    const label = app === "discord" ? "Discord" : "LINE";
    this.pcUnread[app].push(n.title);
    Sound.notify(app, `app-${app}`);
    // Japanese or Korean: the line in letters to read (Settings → Romaji under notices).
    let rom = "";
    if (State.settings.noticeRomanize !== false && scriptOf(n.body) !== "latin") {
      const lang = languageOfLines([n.body]);
      if (lang === "japanese") await ensureJapaneseTokenizer();
      rom = romanizeMixed(n.body, lang, State.settings.lyricsRomajiLangs);
      if (rom === n.body) rom = "";
    }
    const openApp = h("button", { class: "nt-btn p", text: app === "discord" ? t("Open Discord") : t("Open LINE") });
    openApp.addEventListener("click", () => {
      this.pcUnread[app] = [];
      this.close();
      // Where the app itself said the toast leads — a chat of its own, when
      // it says one — or the app as a whole.
      void Bridge.openChatApp(app, n.target ?? null);
    });
    const seen = h("button", { class: "nt-btn s", text: t("Mark as read") });
    seen.addEventListener("click", () => {
      this.pcUnread[app] = [];
      NoticeHistory.markAppRead(app);
      this.close();
    });
    void NoticeHistory.add({
      kind: "chat", app, color,
      label, who: n.title, text: n.body,
    });
    const shown = this.open(color, "approval", [
      source(app, color, label),
      who(app, color, n.title),
      h("div", { class: "nt-msg", text: n.body }),
      ...(rom ? [h("div", { class: "nt-rom", text: rom })] : []),
      h("div", { class: "nt-acts" }, openApp, seen),
    ], true);
    this.noticeChatApp = shown ? app : null;
  }

  /**
   * Discord or LINE itself came to the front (pc_notifications.rs): its
   * messages were read in the app, and Windows sends no receipt back — so
   * the step into the app is the signal, and the unread sign folds away
   * without a click. The chat's own card folds too: its buttons say open
   * the app or mark as read, and both are moot in front of the app itself.
   */
  pcRead(app: string) {
    const key = app === "discord" ? "discord" : "line";
    if (!this.pcUnread[key].length && this.noticeChatApp !== key) return;
    this.pcUnread[key] = [];
    NoticeHistory.markAppRead(key);
    if (this.noticeChatApp === key) this.close();
    else this.sync();
  }

  /** The Claude app, an editor or a terminal came to the front
   *  (pc_notifications.rs): the agent that finished is seen there. */
  agentSeen() {
    const f = this.finished;
    if (!f) return;
    this.finished = null;
    NoticeHistory.markAppRead(f.id);
    if (this.shownNotice && this.noticePose === "finished") this.close();
    else this.sync();
  }

  /** An agent finished while the island was closed. */
  private agentFinished(id: string, name: string, step: string) {
    this.finished = { id, name, step };
    const view = h("button", { class: "nt-btn p", text: t("Open") });
    view.addEventListener("click", () => {
      this.finished = null;
      NoticeHistory.markAppRead(id);
      this.close();
      this.host.openAgents(id);
    });
    const later = h("button", { class: "nt-btn s", text: t("Later") });
    later.addEventListener("click", () => this.close());
    void NoticeHistory.add({
      kind: "agent", app: id, color: "#5fd37a",
      label: name, who: t("finished"), text: step,
    });
    this.open("#39c5bb", "finished", [
      source(id, "#39c5bb", name),
      h("div", { class: "nt-who" }, h("span", { class: "nt-name", text: `✓ ${t("finished")}` })),
      h("div", { class: "nt-msg nt-dim", text: step }),
      h("div", { class: "nt-acts" }, view, later),
    ]);
  }

  /**
   * Miku was just updated: what this version brings, as a notice card
   * (whats-new/controller.ts decides when). False when it cannot show now —
   * the island is open or another card is up — and the controller tries later.
   */
  whatsNew(release: WhatsNewRelease, allChanges: () => void): boolean {
    if (State.mode === "expanded" || this.shownNotice) return false;
    const lang = language();
    const btn = (label: string, kind: "p" | "s", act: () => void) => {
      const b = h("button", { class: `nt-btn ${kind}`, text: label });
      b.addEventListener("click", () => {
        act();
        this.close();
      });
      return b;
    };
    const items = release.items.slice(0, 4).map((item) => {
      const title = localized(item.title, lang);
      return h("span", { class: "nt-wn", title: localized(item.detail, lang) },
        svg(WHATS_NEW_ICONS[iconName(item.icon)], 12, { stroke: 2 }), h("span", { text: title }));
    });
    this.open("#39c5bb", "happy", [
      h("div", { class: "nt-src" }, appIcon("miku", "#39c5bb"), h("span", { text: t("What's new") }),
        h("span", { class: "nt-time", text: release.version })),
      h("div", { class: "nt-who" }, h("span", { class: "nt-name", text: t("You're on Miku {version}", { version: release.version }) })),
      h("div", { class: "nt-wns" }, ...items),
      h("div", { class: "nt-acts" }, btn(t("OK"), "p", () => {}), btn(t("All changes"), "s", allChanges)),
    ]);
    return this.shownNotice;
  }

  /**
   * The first-run hello: who Miku is, and the one setup worth doing
   * (whats-new/controller.ts decides when, once per install). False when it
   * cannot show now — the island is open or another card is up.
   */
  welcome(onSetup: () => void): boolean {
    if (State.mode === "expanded" || this.shownNotice) return false;
    const setup = h("button", { class: "nt-btn p", text: t("Set up the hooks") });
    setup.addEventListener("click", () => {
      onSetup();
      this.close();
    });
    const later = h("button", { class: "nt-btn s", text: t("Later") });
    later.addEventListener("click", () => this.close());
    this.open("#39c5bb", "happy", [
      source("miku", "#39c5bb", t("Welcome")),
      h("div", { class: "nt-who" }, h("span", { class: "nt-name", text: t("I'm Miku. I live at the top of your screen.") })),
      h("div", { class: "nt-msg nt-dim", text: t("Connect the agents you use, and their permission requests come here to be approved.") }),
      h("div", { class: "nt-acts" }, setup, later),
    ]);
    return this.shownNotice;
  }

  /** A new Miku is out (or the hang was clicked): her card, live while it is up. */
  update(): boolean {
    if (State.mode === "expanded" || !Updates.status.latest) return false;
    this.open(UPDATE_COLOR, "surprised", []);
    this.updateShown = true;
    this.updateKey = "";
    this.refreshUpdate();
    return true;
  }

  /** Rebuilds the update card when its phase changes, moves the bar in between. */
  private refreshUpdate() {
    const s = Updates.status;
    const r = s.latest;
    const phase = s.phase;
    // Up to date after all (installed elsewhere, dismissed): nothing left to say.
    if (!r && phase.kind !== "error") return this.close();
    const key = `${phase.kind}~${r?.version}~${s.canInstall}`;
    if (key !== this.updateKey) {
      this.updateKey = key;
      this.noticePose = phase.kind === "error" ? "error" : phase.kind === "idle" ? "surprised" : "working";
      this.noticeBody.replaceChildren(...this.updateBody());
    }
    if (phase.kind === "downloading" && this.updateFill && this.updateLine) {
      const p = percent(phase.fraction);
      this.updateFill.style.width = `${p}%`;
      this.updateLine.textContent = t("Downloading from GitHub… {percent} %", { percent: p });
    }
  }

  private updateBody(): HTMLElement[] {
    const s = Updates.status;
    const r = s.latest;
    const phase = s.phase;
    // A button that also folds the card (Updates' own collapse only reaches the island).
    const btn = (label: string, kind: "p" | "s", act: () => void) => {
      const b = h("button", { class: `nt-btn ${kind}`, text: label });
      b.addEventListener("click", () => {
        act();
        if (kind === "s" || phase.kind === "error" || !s.canInstall) this.close();
      });
      return b;
    };
    const head = h("div", { class: "nt-src" }, appIcon("miku", UPDATE_COLOR), h("span", { text: t("Updates") }),
      h("span", { class: "nt-time", text: r ? `${s.current} → ${r.version}` : s.current }));
    const name = (text: string) => h("div", { class: "nt-who" }, h("span", { class: "nt-name", text }));
    this.updateFill = null;
    this.updateLine = null;

    if (phase.kind === "error") {
      return [head, name(t("The update didn't go through")), h("div", { class: "nt-msg nt-dim", text: phase.message }),
        h("div", { class: "nt-acts" },
          btn(t("Get it on GitHub"), "p", () => Updates.openPage()),
          btn(t("OK"), "s", () => Updates.dismiss()))];
    }
    const title = name(t("Miku {version} is out", { version: r?.version ?? "" }));
    if (phase.kind === "idle") {
      // The corner already says old → new: the headline alone, or what she has.
      const line = r?.headline?.trim() || t("You have {version}", { version: s.current });
      // The portable exe and Linux update the way they were installed: the release page.
      const acts = s.canInstall
        ? [btn(t("Update now"), "p", () => Updates.install()),
          btn(t("What's new"), "s", () => Updates.openPage()),
          btn(t("Later"), "s", () => Updates.later())]
        : [btn(t("Get it on GitHub"), "p", () => Updates.openPage()),
          btn(t("Later"), "s", () => Updates.later())];
      return [head, title, h("div", { class: "nt-msg", text: line }), h("div", { class: "nt-acts" }, ...acts)];
    }
    // Downloading, checking, installing: the bar, and no buttons (nothing to stop mid-way).
    this.updateFill = h("i");
    this.updateLine = h("div", { class: "nt-msg nt-dim" });
    const bar = h("div", { class: `nt-bar${phase.kind === "downloading" ? "" : " indet"}` }, this.updateFill);
    if (phase.kind === "verifying") this.updateLine.textContent = t("Checking the download…");
    if (phase.kind === "installing") this.updateLine.textContent = t("Installing… Miku closes and comes back by itself.");
    return [head, title, bar, this.updateLine];
  }

  // ── The card ───────────────────────────────────────────────────────────────

  private open(color: string, pose: ChibiPose, body: HTMLElement[], ping = false, request = false, tall = false): boolean {
    // The open island already shows everything: no card over it.
    if (State.mode === "expanded") return false;
    // A permission or question waiting on the card is never covered by news:
    // that goes to the Notif page and the sign under the capsule.
    if (!request && this.shownNotice && this.requestShown != null) return false;
    if (!request) this.requestShown = null;
    this.noticeEl.classList.toggle("tall", tall);
    this.updateShown = false;
    this.noticePose = pose;
    this.noticePing = ping;
    this.noticeAt = performance.now();
    this.noticeEl.style.setProperty("--nt", color);
    this.noticeBody.replaceChildren(...body);
    this.noticeEl.classList.add("on");
    this.shownNotice = true;
    // Held while the pointer is on the notch (the closed-hover heartbeat, or
    // the card itself); the fold countdown runs outside it.
    this.resyncFold();
    this.sync();
    this.host.relayout();
    this.loop();
    return true;
  }

  close() {
    this.clearFold();
    this.clearHeartbeat();
    this.hoveringCard = false;
    this.insideNotch = false;
    this.noticeEl.classList.remove("on");
    this.shownNotice = false;
    this.updateShown = false;
    this.noticeChatApp = null;
    void Bridge.focusWindow(false);
    this.sync();
    // The window shrinks once the card has folded away.
    window.setTimeout(() => this.host.relayout(), 260);
  }

  /** The notch's pointer signal. From the cursor poll (open states) it is a
   *  plain level; from `closed-hover` (folded, where the poll is parked) it is
   *  a heartbeat, and its absence is reported as a leave. */
  pointer(onNotch: boolean) {
    this.insideNotch = onNotch;
    this.clearHeartbeat();
    if (onNotch) {
      this.heartbeatTimer = window.setTimeout(() => {
        this.heartbeatTimer = null;
        this.insideNotch = false;
        this.resyncFold();
      }, 1200);
    }
    this.resyncFold();
  }

  /** Held while the pointer is on the notch or the card; outside it, a
   *  countdown folds the card away on its own. */
  private resyncFold() {
    // A permission or question stays until it is answered or folded with Later.
    if (this.hoveringCard || this.insideNotch || this.requestShown != null) {
      this.clearFold();
    } else if (this.shownNotice) {
      this.arm(NOTICE_MS);
    }
  }

  private arm(ms: number) {
    this.clearFold();
    this.foldTimer = window.setTimeout(() => {
      this.foldTimer = null;
      this.close();
    }, ms);
  }

  private clearFold() {
    if (this.foldTimer != null) window.clearTimeout(this.foldTimer);
    this.foldTimer = null;
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer != null) window.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  // ── What hangs under the capsule ────────────────────────────────────────────

  private latestUnread(): WaConversation | null {
    return [...WhatsApp.view.conversations].filter((c) => c.unread > 0)
      .sort((a, b) => b.lastActivity - a.lastActivity)[0] ?? null;
  }

  private current(): Hang | null {
    const req = State.pendingApproval;
    if (req) {
      const who = State.tasks.find((x) => x.id === req.pillId)?.name ?? t("Agent");
      return {
        pose: "approval", color: "#ffd36b", pulse: true,
        key: `a|${language()}|${req.pillId}|${who}|${req.command || req.tool || ""}`,
        html: [h("span", { style: "color:#ffd36b", text: `✋ ${who} ${t("needs permission")}` }),
          h("small", { text: req.command || req.tool || "" })],
        open: () => this.host.openApproval(),
      };
    }
    const unread = WhatsApp.view.unread;
    const line = this.pcUnread.line.length;
    const discord = this.pcUnread.discord.length;
    if (unread + line + discord > 0) {
      const names = [...WhatsApp.view.conversations].filter((c) => c.unread > 0)
        .sort((a, b) => b.lastActivity - a.lastActivity).map((c) => c.name);
      const all = [...names, ...this.pcUnread.line, ...this.pcUnread.discord];
      const badge = (n: number, bg: string, fg = "#06231a") =>
        n > 0 ? [h("b", { class: "hg-bdg", style: `background:${bg};color:${fg}`, text: String(n) })] : [];
      return {
        pose: "approval", color: unread ? "#25d366" : line ? "#06c755" : "#5865f2", pulse: false,
        key: `m|${language()}|${unread}|${line}|${discord}|${[...new Set(all)].slice(0, 3).join(", ")}`,
        html: [h("span", {}, `💬 ${t("Messages")}`, ...badge(unread, "#25d366"), ...badge(line, "#06c755"), ...badge(discord, "#5865f2", "#fff")),
          h("small", { text: [...new Set(all)].slice(0, 3).join(", ") })],
        open: () => {
          if (unread > 0) return this.whatsapp();
          // LINE / Discord: open the app with the most, and count them as seen.
          const app = line >= discord ? "line" : "discord";
          this.pcUnread = { line: [], discord: [] };
          this.sync();
          void Bridge.openChatApp(app);
        },
      };
    }
    // A download under way, or a new version left for later: Miku with its number.
    const s = Updates.status;
    const busy = s.latest != null && s.phase.kind !== "idle" && s.phase.kind !== "error";
    if (s.latest && (busy || Updates.waiting())) {
      const label = s.phase.kind === "downloading" ? `⬇ ${percent(s.phase.fraction)} %` : busy ? "⬇" : "✨";
      return {
        pose: busy ? "working" : "surprised", color: UPDATE_COLOR, pulse: false,
        key: `u|${language()}|${label}|${s.latest.version}|${s.latest.headline ?? ""}`,
        html: [h("span", { style: `color:${UPDATE_COLOR}`, text: `${label} Miku ${s.latest.version}` }),
          h("small", { text: s.latest.headline ?? t("Update now") })],
        open: () => this.update(),
      };
    }
    if (this.finished) {
      const f = this.finished;
      return {
        pose: "finished", color: "#5fd37a", pulse: false,
        key: `f|${language()}|${f.id}|${f.name}|${f.step}`,
        html: [h("span", { style: "color:#5fd37a", text: `✓ ${f.name} ${t("finished")}` }), h("small", { text: f.step })],
        open: () => {
          this.finished = null;
          this.host.openAgents(f.id);
        },
      };
    }
    return null;
  }

  /** Called on every state change: agents that finished, and what hangs. */
  sync() {
    // An agent that turned "finished" while the island was closed is news.
    for (const task of State.tasks) {
      if (task.isIntegration) continue;
      const before = this.lastStates.get(task.id);
      this.lastStates.set(task.id, task.state);
      if (before && before !== "finished" && task.state === "finished" && State.mode !== "expanded") {
        this.agentFinished(task.id, task.name, task.steps[task.steps.length - 1] ?? "");
      }
    }
    // Opening the island is seeing it.
    if (State.mode === "expanded") {
      this.finished = null;
      if (this.shownNotice) this.close();
    }
    if (this.shownNotice && this.updateShown) this.refreshUpdate();

    const hang = State.mode === "expanded" || this.shownNotice ? null : this.current();
    const was = this.shownHang;
    let keyChanged = false;
    if (hang) {
      this.hangPose = hang.pose;
      // The same content would rebuild and re-measure the sign for nothing:
      // both wait for the key to change.
      keyChanged = hang.key !== this.hangKey;
      if (keyChanged) {
        this.hangKey = hang.key;
        this.hangSign.replaceChildren(...hang.html);
        this.hangSign.style.setProperty("--hg", hang.color);
      }
      this.hangSign.classList.toggle("pulse", hang.pulse);
      this.hangEl.classList.add("on");
      this.shownHang = true;
      this.loop();
    } else {
      this.hangEl.classList.remove("on");
      this.shownHang = false;
    }
    // Shown, hidden, or its sign changed width: the window follows.
    const width = this.shownHang ? (keyChanged ? this.hangWidth() : this.lastHangWidth) : 0;
    if (was !== this.shownHang || width !== this.lastHangWidth) {
      this.lastHangWidth = width;
      this.host.relayout();
    }
  }

  /**
   * The width Miku and her sign need, centred on the capsule: Miku is in the
   * middle and the sign to her right, so the room is twice the far edge of the
   * sign from the centre (the window is centred too).
   */
  hangWidth(): number {
    const sign = this.hangSign.offsetWidth || 0;
    // .hg is 92 wide around the centre, the sign starts 86 px into it.
    const right = -46 + 86 + sign + 10;
    return Math.max(HANG_W, Math.ceil(right * 2));
  }

  /** Where the capsule ends: Miku hangs from there. */
  place(capsuleH: number) {
    this.hangEl.style.top = `${Math.max(0, capsuleH - 6)}px`;
  }

  // ── Miku, every frame while one of them is up ───────────────────────────────

  private loop() {
    if (this.raf != null) return;
    const frame = (now: number) => {
      this.raf = null;
      if (!this.shownHang && !this.shownNotice) return;
      const variant = resolveVariantNow(parseVariant(State.settings.mikuVariant));
      const tm = (now - this.started) / 1000;
      if (this.shownNotice) {
        // On the card she stands on the floor with room over her head for the ping's bubble.
        const since = (now - this.noticeAt) / 1000;
        this.paint(this.noticeMiku, PING_TOP, (x) => {
          if (this.noticePing) drawPing(x, since, tm, variant);
          else {
            x.translate(0, PING_TOP);
            drawChibi(x, this.noticePose, tm, variant, { noShadow: true });
          }
        });
      }
      if (this.shownHang) this.paint(this.hangMiku, 0, (x) => drawChibi(x, this.hangPose, tm, variant, { noShadow: true }));
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** Fit the chibi (plus `top` design units of headroom) into the canvas, feet on its bottom edge. */
  private paint(c: HTMLCanvasElement, top: number, draw: (x: CanvasRenderingContext2D) => void) {
    const w = c.clientWidth;
    const hh = c.clientHeight;
    const x = ctx2d(c);
    if (!x || !w || !hh) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(hh * dpr)) c.height = Math.round(hh * dpr);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, c.width, c.height);
    const k = Math.min(c.width / CHIBI_W, c.height / (CHIBI_H + top));
    x.setTransform(k, 0, 0, k, (c.width - CHIBI_W * k) / 2, c.height - (CHIBI_H + top) * k);
    draw(x);
  }
}

/** The card's first line: the app's mark, its name, and when. */
function source(app: string, color: string, label: string): HTMLElement {
  return h("div", { class: "nt-src" }, appIcon(app, color), h("span", { text: label }),
    h("span", { class: "nt-time", text: t("just now") }));
}

/** Who wrote: their initial, badged with the app's mark, and their name. */
function who(app: string, color: string, name: string): HTMLElement {
  return h("div", { class: "nt-who" },
    h("span", { class: "nt-av", style: `--c:${color}`, text: (name || "?").slice(0, 1).toUpperCase() }, appIcon(app, color)),
    h("span", { class: "nt-name", text: name }));
}
