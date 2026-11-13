// What the closed island tells you without opening (docs/mockups/notch-capsule.png,
// docs/mockups/notif-incoming.png, docs/mockups/notch-prototype.html):
//
// - A notice card grows out of the capsule when something arrives — a WhatsApp
//   message (reply right there), an agent that finished — and folds back on its
//   own after a few seconds; the pointer on it keeps it up.
// - Whatever is still unseen afterwards hangs under the capsule: Miku on a thread
//   with a small sign — an agent asking (folded card), unread WhatsApp, an agent
//   that finished. A click opens it.
//
// No DOM of the island's own is touched here: these two live in the island's
// root, beside it, and the island asks how much room they need (window size,
// click area).

import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import { WhatsApp, preview, type WaConversation } from "../core/whatsapp";
import { CHIBI_H, CHIBI_W, drawChibi, type ChibiPose } from "../mochi/chibi";
import { parseVariant, resolveVariant } from "../mochi/wardrobe";
import { h } from "../views/dom";
import { ensureJapaneseTokenizer, languageOfLines, romanizeMixed, scriptOf } from "../lyrics/romanize";
import { t } from "../i18n/i18n";

/** How long a notice stays up without the pointer on it. */
export const NOTICE_MS = 6000;
/** Room the two need, in CSS px (the island adds them to its window and hit area). */
export const NOTICE_W = 470;
export const NOTICE_H = 132;
export const HANG_W = 320;
export const HANG_H = 96;

export interface NoticeHost {
  /** Opens the island on the waiting card (approval or question). */
  openApproval(): void;
  /** Opens the island's deck on the Agents page, on this agent. */
  openAgents(agentId?: string): void;
  /** The room changed: window size and click area follow. */
  relayout(): void;
}

/** What hangs under the capsule: the most important unseen thing. */
interface Hang {
  pose: ChibiPose;
  color: string;
  html: HTMLElement[];
  pulse: boolean;
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
  private hangPose: ChibiPose = "idle";
  private timer: number | null = null;
  private hovering = false;
  private raf: number | null = null;
  private readonly started = performance.now();
  /** The agent that finished while the island was closed, until it is seen. */
  private finished: { id: string; name: string; step: string } | null = null;
  private lastStates = new Map<string, string>();
  private shownHang = false;
  /** LINE / Discord messages seen as toasts and not opened yet. */
  private pcUnread: { line: string[]; discord: string[] } = { line: [], discord: [] };
  private shownNotice = false;

  constructor(private host: NoticeHost) {
    this.noticeMiku = h("canvas", { class: "nt-miku" }) as HTMLCanvasElement;
    this.noticeBody = h("div", { class: "nt-body" });
    this.noticeEl = h("div", { class: "nt-card" }, this.noticeMiku, this.noticeBody);
    this.noticeEl.addEventListener("mouseenter", () => {
      this.hovering = true;
      this.clearTimer();
    });
    this.noticeEl.addEventListener("mouseleave", () => {
      this.hovering = false;
      if (this.noticeEl.classList.contains("on") && !this.noticeEl.dataset.sticky) this.arm(NOTICE_MS / 2);
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
    input.addEventListener("focus", () => {
      this.hovering = true;
      this.clearTimer();
    });
    input.addEventListener("blur", () => void Bridge.focusWindow(false));
    later.addEventListener("click", () => this.close());
    this.open("#25d366", "approval", [
      h("div", { class: "nt-src", style: "color:#25d366" }, "💬 WHATSAPP", h("span", { class: "nt-time", text: t("just now") })),
      h("div", { class: "nt-who" },
        h("span", { class: "nt-av", style: "background:#25d366", text: conv.name.slice(0, 1).toUpperCase() }),
        h("span", { class: "nt-name", text: conv.name })),
      h("div", { class: "nt-msg", text: last ? preview(last, conv.isGroup) : "" }),
      h("div", { class: "nt-acts" }, input, send, later),
    ]);
  }

  /** A LINE or Discord toast Windows showed: its card, and a reply that opens the app. */
  async pcNotification(n: { app: string; title: string; body: string }) {
    const app = n.app === "discord" ? "discord" : "line";
    const color = app === "discord" ? "#5865f2" : "#06c755";
    const label = app === "discord" ? "🎮 DISCORD" : "💬 LINE";
    this.pcUnread[app].push(n.title);
    // Japanese or Korean: the line in letters to read, as the lyrics do.
    let rom = "";
    if (State.settings.lyricsRomanize !== false && scriptOf(n.body) !== "latin") {
      const lang = languageOfLines([n.body]);
      if (lang === "japanese") await ensureJapaneseTokenizer();
      rom = romanizeMixed(n.body, lang, State.settings.lyricsRomajiLangs);
      if (rom === n.body) rom = "";
    }
    const openApp = h("button", { class: "nt-btn p", text: app === "discord" ? t("Open Discord") : t("Open LINE") });
    openApp.addEventListener("click", () => {
      this.pcUnread[app] = [];
      this.close();
      void Bridge.openChatApp(app);
    });
    const seen = h("button", { class: "nt-btn s", text: t("Mark as read") });
    seen.addEventListener("click", () => {
      this.pcUnread[app] = [];
      this.close();
    });
    this.open(color, "approval", [
      h("div", { class: "nt-src", style: `color:${color}` }, label, h("span", { class: "nt-time", text: t("just now") })),
      h("div", { class: "nt-who" },
        h("span", { class: "nt-av", style: `background:${color}`, text: (n.title || "?").slice(0, 1).toUpperCase() }),
        h("span", { class: "nt-name", text: n.title })),
      h("div", { class: "nt-msg", text: n.body }),
      ...(rom ? [h("div", { class: "nt-rom", text: rom })] : []),
      h("div", { class: "nt-acts" }, openApp, seen),
    ]);
  }

  /** An agent finished while the island was closed. */
  private agentFinished(id: string, name: string, step: string) {
    this.finished = { id, name, step };
    const view = h("button", { class: "nt-btn p", text: t("Open") });
    view.addEventListener("click", () => {
      this.finished = null;
      this.close();
      this.host.openAgents(id);
    });
    const later = h("button", { class: "nt-btn s", text: t("Later") });
    later.addEventListener("click", () => this.close());
    this.open("#5fd37a", "finished", [
      h("div", { class: "nt-src", style: "color:#5fd37a" }, `✓ ${name.toUpperCase()}`, h("span", { class: "nt-time", text: t("just now") })),
      h("div", { class: "nt-msg nt-big", text: t("finished") }),
      h("div", { class: "nt-msg nt-dim", text: step }),
      h("div", { class: "nt-acts" }, view, later),
    ]);
  }

  // ── The card ───────────────────────────────────────────────────────────────

  private open(color: string, pose: ChibiPose, body: HTMLElement[]) {
    // The open island already shows everything: no card over it.
    if (State.mode === "expanded") return;
    this.noticePose = pose;
    this.noticeEl.style.setProperty("--nt", color);
    this.noticeBody.replaceChildren(...body);
    this.noticeEl.classList.add("on");
    this.shownNotice = true;
    this.arm(NOTICE_MS);
    this.sync();
    this.host.relayout();
    this.loop();
  }

  close() {
    this.clearTimer();
    this.hovering = false;
    this.noticeEl.classList.remove("on");
    this.shownNotice = false;
    void Bridge.focusWindow(false);
    this.sync();
    // The window shrinks once the card has folded away.
    window.setTimeout(() => this.host.relayout(), 260);
  }

  private arm(ms: number) {
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (!this.hovering) this.close();
    }, ms);
  }

  private clearTimer() {
    if (this.timer != null) window.clearTimeout(this.timer);
    this.timer = null;
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
    if (this.finished) {
      const f = this.finished;
      return {
        pose: "finished", color: "#5fd37a", pulse: false,
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

    const hang = State.mode === "expanded" || this.shownNotice ? null : this.current();
    const was = this.shownHang;
    if (hang) {
      this.hangPose = hang.pose;
      this.hangSign.replaceChildren(...hang.html);
      this.hangSign.style.setProperty("--hg", hang.color);
      this.hangSign.classList.toggle("pulse", hang.pulse);
      this.hangEl.classList.add("on");
      this.shownHang = true;
      this.loop();
    } else {
      this.hangEl.classList.remove("on");
      this.shownHang = false;
    }
    if (was !== this.shownHang) this.host.relayout();
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
      const variant = resolveVariant(parseVariant(State.settings.mikuVariant), new Date());
      const tm = (now - this.started) / 1000;
      if (this.shownNotice) this.paint(this.noticeMiku, this.noticePose, tm, variant);
      if (this.shownHang) this.paint(this.hangMiku, this.hangPose, tm, variant);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private paint(c: HTMLCanvasElement, pose: ChibiPose, tm: number, variant: ReturnType<typeof resolveVariant>) {
    const w = c.clientWidth;
    const hh = c.clientHeight;
    const x = c.getContext("2d");
    if (!x || !w || !hh) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(hh * dpr)) c.height = Math.round(hh * dpr);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, c.width, c.height);
    const k = Math.min(c.width / CHIBI_W, c.height / CHIBI_H);
    x.setTransform(k, 0, 0, k, (c.width - CHIBI_W * k) / 2, c.height - CHIBI_H * k);
    drawChibi(x, pose, tm, variant, { noShadow: true });
  }
}
