// The island: DOM shell, sizing animation, Mochi placement, mouse handling.
// Mirrors IslandRootView.swift + IslandWindowController.swift.

import { Tracked, Spring, clamp } from "../core/anim";
import { Bridge, IS_TAURI, onDragDrop } from "../core/bridge";
import {
  CLOSED_BOT_D, CLOSED_H, CLOSED_PAD, closedContent, closedIsland, closedWidth, type ClosedContent,
} from "../core/closed";
import {
  EXPANDED_CORNER, EXPANDED_W, NOTCH_W, PANEL_H, PANEL_W,
  ROUNDED_CORNER, STAGE_CORNER, VIEW_LAYOUTS, botGlowColor, botGlowOpacity, botPosition, chatPromptHeight,
  islandSize,
  QUESTION_PICKER_H,
  type BotEmoteName, type IslandMode, type IslandViewName,
} from "../core/layout";
import { Sound } from "../core/sound";
import { State, type Ritual } from "../core/state";
import { withMode } from "../core/approval-modes";
import { SPOTIFY_ID, Spotify, currentArtwork, formatTime, islandDances, desktopDances, spotifyPosition, type SpotifyState } from "../core/spotify";
import { CHIBI_H, CHIBI_W, drawChibi } from "../mochi/chibi";
import { cachedSong, fetchSong, knownMissing } from "../lyrics/fetch";
import { lineIndexAt, nextSungLine, previousSungLine, type Song } from "../lyrics/lrc";
import { ensureJapaneseTokenizer, japaneseReady, languageOfLines, romanizeMixed } from "../lyrics/romanize";
import { looksLikeSong } from "../lyrics/song";
import { HIDE_AFTER_PAUSE_MS, holdStillUp } from "../lyrics/state";
import { BotEngine, hexToRGB } from "../mochi/engine";
import { Ambient, ambientFor } from "../mochi/ambient";
import { Greeting } from "../mochi/greeting";
import { bandStats } from "../mochi/music";
import { skyTint, type SkyTint } from "../mochi/sky";
import { BREAK_AFTER_MS, BreakTracker } from "../mochi/session";
import { miniBotCount, syncMiniBotStates, tickMiniBots } from "../mochi/minibots";
import { SeasonCache, VariantCache, parseOutfit, parseVariant, resolveVariant } from "../mochi/wardrobe";
import { UploadCanvas } from "../upload/canvas";
import { USC, UploadSeq } from "../upload/sequence";
import { dominantPct, planColor } from "../core/plan";
import { language, t, tl } from "../i18n/i18n";
import { claudeCompactPillVisible, closePlanCard, openPlanColor, planCardOpen } from "../views/usage";
import { buildHeader, buildViews, type ViewActions, type ViewHost } from "../views/views";
import { h, svg } from "../views/dom";
import { ICONS } from "../views/icons";
import { IslandStateMachine } from "./fsm";
import { HANG_H, NOTICE_H, NOTICE_W, Notices } from "./notices";
import { openDeckOn } from "../views/deck";
import { refreshHookPills } from "./integrations";
import { restoreAlertFocus } from "./hooks";
import { DesktopLink } from "./desktop";
import type { ViewCommand } from "./shortcuts";
import { DRAG_THRESHOLD } from "../mochi/desktop-logic";
import { Updates } from "./update";
import { UPDATE_BLUE, showsUpdateHint } from "../whats-new/whats-new";

const BOT_OVERHANG = 40;
const UPDATE_BLUE_RGB = hexToRGB(UPDATE_BLUE);
const CLAUDE_DESKTOP_ID = "agent_claude-desktop";
/** Extra canvas on each side of Mochi, for the witch hat's brim and the Santa hat's tip. */
const BOT_SIDE = 24;
/** Same margin as the Rust hit test (src-tauri/src/island.rs). */
const HIT_MARGIN = 14;

/** The three views the drop sequence owns; leaving them stops the engine. */
const UPLOAD_VIEWS: ReadonlySet<IslandViewName> = new Set(["upload", "uploading", "choose"]);

/** Seconds between the drop and the moment the progress bar starts filling. */
const PRE_PROGRESS = USC.T_PROG_START - USC.T_DROP;

/** The synth strip (closed island, "mochi" style): Miku's centre from the left
 *  edge, and what it adds to closedWidth's 2×CLOSED_PAD so the island hugs its
 *  content: style.css pads it 32 (her head) + 12, the equaliser is 33 + a 7 gap. */
const SYNTH_BOT_X = 16;
const SYNTH_HEAD = 32 + 12 - 2 * CLOSED_PAD;
const SYNTH_EXTRA = SYNTH_HEAD + 33 + 7;
/** How often the stage re-reads the sung line and its clock, in ms (Miku has her own frame loop). */
const LYRICS_TICK_MS = 200;

/** How long after a words-less answer the same track may be asked again, in ms.
 *  LRCLIB answers 503 in busy minutes, and that answer must not blank the pill
 *  for the rest of the song. */
const LYRICS_RETRY_MS = 20_000;

const modeOrder = (m: IslandMode) => (m === "hidden" ? 0 : m === "compact" ? 1 : 2);

export class Island {
  readonly fsm = new IslandStateMachine();
  /** Mochi on the desktop: his life cycle and the drag out of the island. */
  readonly desktop: DesktopLink;

  private root: HTMLElement;
  private islandEl!: HTMLElement;
  private clipEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private viewsEl!: HTMLElement;
  private botCanvas!: HTMLCanvasElement;
  private botGlow!: HTMLElement;
  private greetingCanvas!: HTMLCanvasElement;
  private clockEl!: HTMLElement;
  private clockTimer?: number;
  /** The closed island's one line (core/closed.ts), and what it last showed. */
  private closedEl!: HTMLElement;
  private closedDot!: HTMLElement;
  private closedText!: HTMLElement;
  private closedEq!: HTMLElement;
  private closedKey = "";
  /** Width of the closed island for what it shows now. */
  private closedW = 120;
  /** Mochi's little life in the closed island: where he looks, and until when
   *  the loop runs for what he is doing (a blink, a glance). */
  private closedLook = { x: 0, y: 0 };
  private closedAwakeUntil = 0;
  private closedLife: number | null = null;
  /** The size the window was last folded to, so a new one is only sent on a change. */
  private collapsedTo = { w: 0, h: 0 };
  /** The notice card and Miku under the capsule (island/notices.ts). */
  private notices!: Notices;
  private countdown!: HTMLElement;
  private compactPlan!: HTMLElement;
  private compactPlanDot!: HTMLElement;
  private compactPlanLabel!: HTMLElement;
  private wakeStrip!: HTMLElement;
  private lyricsPill!: HTMLElement;
  private lyricsSong: Song = { timed: [], plain: [] };
  private lyricsKey = "";
  /** A feed app (Instagram, TikTok) has taken the session the song was on: the
   *  words stay up, frozen, until the song reports again. */
  private lyricsFeedHold = false;
  /** When that takeover started: the hold lasts HOLD_MAX_MS at most. */
  private lyricsFeedSince: number | null = null;
  /** A song whose words could not be had: the key and when to ask again. */
  private lyricsRetryKey = "";
  private lyricsRetryAt = 0;
  private lyricsLoading = false;
  private lyricsGeneration = 0;
  private lyricsTicker: number | null = null;
  /** The line the pill shows now, and the words already romanized for it. */
  private lyricsShownKey = "";
  private lyricsRomanized = new Map<number, string>();

  private header!: ViewHost;
  private views!: Map<IslandViewName, ViewHost>;
  private uploadCanvas!: UploadCanvas;

  private width = new Tracked(NOTCH_W);
  private height = new Tracked(0);
  private radius = new Tracked(ROUNDED_CORNER);
  /** Where the springs are headed: the DOM lays out here while they run. */
  private sizeTarget = { w: NOTCH_W, h: 0, r: ROUNDED_CORNER };
  private botCx = new Spring(46);
  private botCy = new Spring(16);
  private botSize = new Spring(10);

  private engine = new BotEngine();
  /** The music watch's last asked state, so Rust hears of changes only. */
  private musicWatch: boolean | null = null;
  /** The last `--beat` value written, so the style write is sparse. */
  private lastBeat = -1;
  /** The hour's light, remembered so the clock is read once an hour. */
  private skyHour = -1;
  private skyValue: SkyTint = { rgb: [1, 1, 1], strength: 0 };
  /** The working-session clock (a break worth mentioning) and when it last ran. */
  private breakTracker = new BreakTracker();
  private breakCheckedAt = 0;

  /** The hour's light (sky.ts), read once an hour. */
  private skyNow(): SkyTint {
    const h = new Date().getHours();
    if (h !== this.skyHour) {
      this.skyHour = h;
      this.skyValue = skyTint(h);
    }
    return this.skyValue;
  }
  /** The weather behind the island's content (Snow/Sakura); classic has none. */
  private ambientCanvas = h("canvas", { id: "ambient-canvas" });
  private ambient = new Ambient(this.ambientCanvas);
  private greeting = new Greeting();
  private greetingShown = false;
  private seasons = new SeasonCache();
  /** "auto" → which Miku the season dresses her as, remembered for the day. */
  private variants = new VariantCache();

  private running = false;
  private lastFrame = 0;
  private dirty = true;
  private canvasPx = 0;
  /** The pixel ratio Mochi's bitmap was sized for: it changes with the monitor. */
  private canvasDpr = 0;
  /** The drawing context of that bitmap; it survives a resize. */
  private botCtx: CanvasRenderingContext2D | null = null;
  /** What the glow was last drawn as, so an unchanged frame writes nothing. */
  private glowKey = "";
  private glowVisible = false;

  // Rust starts the window at full size so the launch greeting has room.
  private collapsed = false;
  private collapseTimer: number | null = null;
  private wasInIsland = false;
  /** A reply is being typed in a card (WhatsApp): the island stays open. */
  private holdingOpen = false;
  /** Last shape handed to Rust for the click-through test. */
  private pushedRect = { x: -1, y: -1, w: -1, h: -1 };

  // Bot hover → love (IslandWindowController.botHoverIn)
  private botHovering = false;
  private botHoverTimer: number | null = null;
  private lastLoveTime = 0;
  private botHoverStart = { x: 0, y: 0 };

  private confusedRecovery: number | null = null;
  private prevViewBeforeConfused: IslandViewName = "overview";
  private lastSyncedView: IslandViewName | null = null;

  /** The launch greeting ended, or the island came out of hidden — two of the
   *  moments the Monday recap may open (see src/recap/recap.ts). */
  onGreetingDone: (() => void) | null = null;
  onWake: (() => void) | null = null;

  /** Where a press on Mochi started: moving past DRAG_THRESHOLD drags him out. */
  private botPress: { x: number; y: number } | null = null;

  /** The next reveal from hidden makes no peek (music starting, as on macOS). */
  private silentReveal = false;

  /** Drop sequence bookkeeping: last tick played, and whether the ✓ has fired. */
  private uploadTens = 0;
  private uploadDone = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.desktop = new DesktopLink({
      reveal: () => this.reveal(),
      wardrobeFromDesktop: () => this.wardrobeFromDesktop(),
      dizzyFromDesktop: () => this.handleDizzy(),
    });
    this.build();
    this.wireFsm();
    this.wireInput();
    this.engine.onDizzy = () => this.handleDizzy();
    this.greeting.onComplete = () => {
      this.fsm.greetComplete();
      this.onGreetingDone?.();
    };
    State.subscribe(() => {
      this.dirty = true;
      this.syncLyricsPill(Spotify.state).catch(() => undefined);
      this.ensureRunning();
    });
  }

  /** The request has its answer: the card goes and the session carries on. */
  private closeApproval() {
    State.endApproval();
    if (State.pendingApproval) {
      const view = State.pendingApproval.questions ? "question" : "approval";
      this.setView(view);
      Sound.play(view);
      return;
    }
    this.fsm.pinned = false;
    this.setView(State.defaultView());
  }

  /**
   * Folds a card that is waiting for an answer down to the compact island,
   * without answering it (Mac #290). Nothing is decided: the request keeps
   * waiting, the island stays on screen, and opening it shows the card again.
   */
  foldApproval() {
    if (!State.pendingApproval || State.mode !== "expanded") return;
    State.isPinned = true;
    this.fsm.pinned = true;
    this.fsm.forcePetit();
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────

  private build() {
    const actions: ViewActions = {
      setView: (v) => this.setView(v),
      cancelDrop: () => this.discardDrop(),
      collapse: () => this.collapse(),
      foldApproval: () => this.foldApproval(),
      setFocus: (id) => {
        State.setFocus(id);
        // Another slide: a two-note chime (scripts/gen-sounds.mjs).
        Sound.play("slide");
        // A pill with a waiting request opens on its card: going back to it
        // after looking at another pill brings the card up again.
        const req = State.pendingApproval;
        if (req?.pillId === id) this.setView(req.questions ? "question" : "approval");
      },
      openTerminal: () => {
        const task = State.focusTask;
        // Sessions from the Claude desktop app live there, not in a terminal.
        if (task?.id === CLAUDE_DESKTOP_ID) void Bridge.openClaudeDesktop();
        else void Bridge.openSession(task?.sessionId ?? null, task?.sessionCwd ?? null);
      },
      // The ↗ button — same targets as openAgentTarget() on macOS.
      openTarget: () => {
        const task = State.focusTask;
        if (!task) return;
        const urls: Record<string, string> = {
          integration_resend: "https://resend.com/emails",
          integration_vercel: "https://vercel.com/dashboard",
          integration_github: "https://github.com/pulls",
          integration_stripe: "https://dashboard.stripe.com/payments",
          integration_notion: "https://notion.so",
          integration_calcom: "https://app.cal.com/bookings",
          // No WhatsApp app to bring forward here as on the Mac: WhatsApp Web, in the browser.
          integration_whatsapp: "https://web.whatsapp.com",
        };
        if (task.id === CLAUDE_DESKTOP_ID) void Bridge.openClaudeDesktop();
        else if (task.id === "integration_claude" || task.sessionId) {
          void Bridge.openSession(task.sessionId ?? null, task.sessionCwd ?? null);
        } else if (task.id === "integration_n8n") void Bridge.openN8n();
        else if (task.id === "integration_gitea") void Bridge.openGitea();
        else if (task.id === SPOTIFY_ID) void Bridge.spotifyOpen();
        else if (urls[task.id]) void Bridge.openUrl(urls[task.id]);
      },
      openUrl: (url) => {
        if (url) void Bridge.openUrl(url);
      },
      decide: (d) => {
        const req = State.pendingApproval;
        void Bridge.log(`decide ${d} req=${req?.requestId ?? "none"}`);
        if (!req) return;
        Sound.play(d === "deny" ? "blip" : "approve");
        void Bridge.approvalDecision(req.requestId, d);
        this.closeApproval();
      },
      rememberApproval: () => {
        // The card's Always: this tool asks no more — the same switch as
        // Settings → Agents → Approvals, flipped from where the ask happened.
        const req = State.pendingApproval;
        if (!req) return;
        State.settings.approvalModes = withMode(State.settings.approvalModes ?? {}, req.tool, "always");
        void Bridge.approvalModesSet(State.settings.approvalModes);
        this.engine.triggerEmote("proud", 1.6);
      },
      answer: (answers) => {
        const req = State.pendingApproval;
        if (!req) return;
        Sound.play("approve");
        void Bridge.approvalAnswer(req.requestId, answers);
        this.closeApproval();
      },
      answerInTerminal: () => {
        const req = State.pendingApproval;
        if (!req) return;
        Sound.play("blip");
        void Bridge.approvalDecline(req.requestId);
        this.closeApproval();
      },
      toggleSound: () => {
        State.settings.soundEnabled = !State.settings.soundEnabled;
        Sound.setEnabled(State.settings.soundEnabled);
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      setVolume: (v) => {
        State.settings.soundVolume = v;
        Sound.setVolume(v);
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      setAutoClose: (s) => {
        State.settings.autoCloseInterval = s;
        this.fsm.homeToPetitDelay = s;
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      openSettingsWindow: () => void Bridge.openSettingsWindow(),
      toggleSlide: (id) => {
        State.toggleIntegration(id);
        void Bridge.saveSettings(State.settings);
        Sound.play("blip");
      },
      blip: () => Sound.play("blip"),
      chooseOutfit: (selection) => {
        if (parseOutfit(State.settings.mochiOutfit) === selection) return;
        State.settings.mochiOutfit = selection;
        void Bridge.saveSettings(State.settings);
        Sound.play("pop");
        this.engine.triggerEmote("proud");
        State.notify();
      },
      previewOutfit: (outfit) => {
        State.wardrobePreview = outfit;
        State.notify();
      },
      chooseVariant: (selection) => {
        if (parseVariant(State.settings.mikuVariant) === selection) return;
        State.settings.mikuVariant = selection;
        void Bridge.saveSettings(State.settings);
        Sound.play("pop");
        this.engine.triggerEmote("proud");
        State.notify();
      },
      previewVariant: (variant) => {
        State.variantPreview = variant;
        // The window and the pill try the skin on too, without keeping it.
        void Bridge.emitSkinPreview(variant);
        State.notify();
      },
      keyboard: (on) => {
        // The chat view manages the keyboard on its own.
        if (on) void Bridge.focusWindow(true);
        else if (State.view !== "prompt" && State.mode === "expanded") void Bridge.focusWindow(false);
      },
      holdOpen: (on) => {
        if (this.holdingOpen === on) return;
        this.holdingOpen = on;
        if (on) {
          this.fsm.pinned = true;
          this.fsm.cancelTimers();
        } else {
          this.fsm.pinned = State.isPinned || State.pendingApproval != null;
          if (!this.fsm.pinned && !this.wasInIsland && this.fsm.state === "home") this.fsm.mouseLeft();
        }
      },
    };

    this.wakeStrip = h("div", { id: "wake-strip" });
    this.lyricsPill = h("div", { id: "lyrics-pill" });
    this.lyricsPill.hidden = true;
    // Right-click is the card's own: detach it from the top edge. It must not
    // also reach the island's press handler, which would open the card first.
    this.lyricsPill.addEventListener("mousedown", (e) => {
      if (e.button === 2) e.stopPropagation();
    });
    this.lyricsPill.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void Bridge.lyricsSetPlacement("floating");
    });
    this.closedDot = h("span", { class: "dot" });
    this.closedText = h("span", { class: "text" });
    // The synth strip's equaliser: five bars, moved by CSS while something plays or works.
    this.closedEq = h("span", { class: "eq" }, h("i"), h("i"), h("i"), h("i"), h("i"), h("i"), h("i"));
    this.closedEl = h("div", { id: "island-closed" }, this.closedEq, this.closedDot, this.closedText);
    this.botGlow = h("div", { id: "bot-glow" });
    this.botCanvas = h("canvas", { id: "bot-canvas" });
    this.greetingCanvas = h("canvas", { id: "greeting-canvas" });
    this.clockEl = h("div", { id: "island-clock" });
    this.countdown = h("div", { id: "countdown" });
    this.compactPlanDot = h("i", { class: "compact-plan-dot" });
    this.compactPlanLabel = h("span", { class: "compact-plan-label" });
    this.compactPlan = h(
      "button",
      {
        id: "compact-plan",
        title: tl("Claude plan usage"),
        onmousedown: (e) => {
          e.stopPropagation();
        },
        onclick: (e) => {
          e.stopPropagation();
          const me = e as MouseEvent;
          if (me.button === 0) this.openClaudePlan();
        },
      },
      this.compactPlanDot,
      this.compactPlanLabel,
    );

    this.header = buildHeader(actions);
    this.views = buildViews(actions, () => this.animateGeometry(false));
    this.viewsEl = h("div", { id: "views" });
    for (const v of this.views.values()) this.viewsEl.append(v.el);
    this.contentEl = h("div", { id: "content" }, this.header.el, this.viewsEl);

    // The drop sequence draws the card, the bar and its own Mochi. It sits under
    // the header, which stays visible on top of it exactly as on macOS.
    this.uploadCanvas = new UploadCanvas({
      ask: () => {
        State.promptContext = State.droppedFile
          ? { kind: "file", name: State.droppedFile.name, path: State.droppedFile.path }
          : null;
        this.setView("prompt");
      },
      cancel: () => this.discardDrop(),
    });

    this.clipEl = h(
      "div",
      { id: "island-clip" },
      this.ambientCanvas,
      this.greetingCanvas,
      this.uploadCanvas.el,
      this.contentEl,
    );
    // The body is laid out at the island's final size and never scaled: the
    // shell around it resizes, so Miku and the text keep their shape in flight.
    this.bodyEl = h(
      "div",
      { id: "island-body" },
      this.clipEl,
      this.botGlow,
      this.botCanvas,
      this.compactPlan,
      this.clockEl,
      this.closedEl,
      this.countdown,
    );
    this.islandEl = h("div", { id: "island" }, this.bodyEl);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.greetingCanvas.width = Math.round(EXPANDED_W * dpr);
    this.greetingCanvas.height = Math.round(150 * dpr);
    this.greetingCanvas.style.width = `${EXPANDED_W}px`;
    this.greetingCanvas.style.height = "150px";

    this.notices = new Notices({
      openApproval: () => this.alert(State.pendingApproval?.questions ? "question" : "approval"),
      openAgents: (agentId) => {
        openDeckOn("agents", agentId);
        this.setView("overview");
      },
      relayout: () => {
        if (State.mode === "hidden") this.sendCollapsedSize(true);
        this.pushedRect = { x: -1, y: -1, w: -1, h: -1 };
        this.applyGeometry();
      },
    });
    this.root.append(this.wakeStrip, this.islandEl, this.notices.hangEl, this.notices.noticeEl);
    this.bodyEl.append(this.lyricsPill);
    this.applyGeometry();
  }

  // ── FSM ─────────────────────────────────────────────────────────────────────

  private wireFsm() {
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.fsm.openOnHover = State.settings.openOnHover;
    this.fsm.onTransition = (from, to) => {
      // The greeting is over, however it ended: back to his desktop spot.
      if (from === "miku" && to !== "miku") this.desktop.launch();
      switch (to) {
        case "hidden":
          this.setMode("hidden");
          break;
        case "petit":
          if (from === "miku") this.greeting.interrupt();
          else if (from === "hidden" && !this.silentReveal) Sound.play("peek");
          this.setMode("compact");
          if (from === "miku") State.view = State.defaultView();
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "home":
          this.expand(this.openingView());
          if (!this.wasInIsland) this.fsm.mouseLeft();
          // Hooks may have been installed in a terminal since: the idle cards
          // say so on the next open, without polling while the island is shut.
          void refreshHookPills();
          break;
        case "miku":
          this.expand("greeting");
          this.greeting.start();
          break;
      }
      State.notify();
      if (from === "hidden") this.onWake?.();
    };
  }

  launch() {
    this.fsm.launch();
  }

  // ── Mode / view ─────────────────────────────────────────────────────────────

  private setMode(mode: IslandMode) {
    const prev = State.mode;
    if (mode === prev) return;
    State.mode = mode;
    // The stylesheet dresses the open island as a stage (style.css, "Stage").
    this.islandEl.dataset.mode = mode;
    if (mode === "expanded") Sound.play("open");
    if (prev === "expanded") {
      Sound.play("close");
      // A folded card is still waiting: it keeps the island pinned.
      if (!State.pendingApproval) State.isPinned = false;
      void Bridge.focusWindow(false);
      // Another pill's alert borrowed the front: the pill you had comes back (Mac).
      restoreAlertFocus();
    }
    if (mode !== "expanded") {
      closePlanCard();
      this.engine.resetMorph();
      // Nothing can be seen of the sequence once the island is shut, and leaving
      // it running would keep the frame loop awake — the island must cost
      // nothing while hidden.
      UploadSeq.deactivate();
    }
    // Folding all the way: the closed island's width for what it will show.
    if (mode === "hidden") this.updateClosed();
    else this.closedEl.classList.remove("on");
    this.scheduleClosedLife();
    this.updateWindowCollapsed();
    this.animateGeometry(modeOrder(mode) < modeOrder(prev));
    // The lyric lines belong to the compact pill alone: an open card, a hidden
    // island and the drop sequence all step over them.
    this.refreshLyricsPill();
    State.notify();
  }

  /** True while the drop sequence owns the island body. */
  private get uploadActive(): boolean {
    return State.mode === "expanded" && UploadSeq.isActive && UPLOAD_VIEWS.has(State.view);
  }

  /** Navigating out of the drop flow ends the sequence, as on macOS. */
  private stopSequenceIfLeaving(view: IslandViewName) {
    if (UploadSeq.isActive && !UPLOAD_VIEWS.has(view)) UploadSeq.deactivate();
  }

  /** Click on compact plan gauge: opens the Claude plan card on the overview. */
  openClaudePlan() {
    Sound.resume();
    State.lastActivity = performance.now();
    this.fsm.userInteracted();
    State.planDetailIsCodex = false;
    State.showingPlanDetail = true;
    this.fsm.forceHome();
    this.expand("overview");
    State.notify();
  }

  expand(view: IslandViewName) {
    this.stopSequenceIfLeaving(view);
    if (view !== "overview") closePlanCard();
    State.view = view;
    if (State.mode !== "expanded") this.setMode("expanded");
    else this.animateGeometry(false);
    State.lastActivity = performance.now();
    State.notify();
  }

  setView(view: IslandViewName) {
    this.stopSequenceIfLeaving(view);
    if (view !== "overview") closePlanCard();
    if (State.mode !== "expanded") {
      this.fsm.forceHome();
      State.view = view;
      this.animateGeometry(false);
      State.notify();
      return;
    }
    const grew = VIEW_LAYOUTS[view].height >= VIEW_LAYOUTS[State.view].height;
    State.view = view;
    State.lastActivity = performance.now();
    this.animateGeometry(!grew);
    State.notify();
  }

  collapse() {
    // A waiting card is only ever folded, never dropped by a close.
    if (State.pendingApproval) {
      this.foldApproval();
      return;
    }
    State.isPinned = false;
    this.fsm.pinned = false;
    // Drive the state machine rather than the mode: setting the mode behind its
    // back left it thinking the island was still open, and a click on the compact
    // island then did nothing — the island could never be reopened.
    this.fsm.forcePetit();
  }

  /** Alert from the hook server: open on this view. Pinned alerts never auto-close. */
  alert(view: IslandViewName) {
    this.fsm.pinned = State.isPinned;
    this.fsm.forceHome();
    this.expand(view);
  }

  /** A new Miku waits and Mochi has nothing else to say (he is blue). */
  private updateHintOn(): boolean {
    return !State.paused && showsUpdateHint(Updates.waiting(), State.effectiveState, State.pendingApproval != null);
  }

  /**
   * What a click or a hover opens on: while Mochi is blue, the new version
   * ("Miku X is out", Update now); otherwise the usual view. A waiting
   * permission or question always comes first.
   */
  private openingView(): IslandViewName {
    return this.updateHintOn() ? "update" : State.defaultView();
  }

  reveal() {
    this.fsm.reveal();
  }

  /** Music started playing: the compact island, without the peek sound (musicReveal). */
  revealSilently() {
    this.silentReveal = true;
    this.fsm.reveal(this.wantsLyricsPill());
    this.silentReveal = false;
  }

  /** Right-click on Mochi: wardrobe open ↔ back to the usual view. */
  toggleWardrobe() {
    if (State.paused || State.mode === "hidden") return;
    // The greeting and the drop sequence draw a Mochi of their own.
    if (State.mode === "expanded" && (State.view === "greeting" || this.uploadActive)) return;
    if (State.mode === "expanded" && State.view === "wardrobe") this.setView(State.defaultView());
    else this.setView("wardrobe");
  }

  /**
   * Right-click on the desktop Mochi (macOS openWardrobeFromDesktop): opens the
   * wardrobe from any state, or goes back if it is already open.
   */
  wardrobeFromDesktop() {
    this.wardrobeAnywhere();
  }

  /**
   * The wardrobe from any state — compact or hidden island included — or back
   * to the usual view if it is already open. The desktop Mochi's right-click
   * and the wardrobe shortcut (`open-wardrobe`) both land here.
   */
  wardrobeAnywhere() {
    if (State.mode === "expanded" && State.view === "wardrobe") {
      this.setView(State.defaultView());
      return;
    }
    if (State.paused) return;
    this.alert("wardrobe");
  }

  /** An alert stopped waiting for an answer: let the island auto-close again. */
  dropPin() {
    this.fsm.pinned = false;
    // The countdown the pin held back starts now, if the mouse is elsewhere.
    if (!this.wasInIsland) this.fsm.mouseLeft();
  }

  // ── Keyboard shortcuts (island/shortcuts.ts) ────────────────────────────────

  emote(name: BotEmoteName) {
    this.engine.triggerEmote(name);
    this.ensureRunning();
  }

  /** Ctrl+P: keep the open island from folding away, or let it fold again. */
  setPinned(on: boolean) {
    State.isPinned = on;
    this.fsm.pinned = on;
    if (on) {
      // The countdown bar reads the state machine's deadline, cleared with it.
      this.fsm.cancelTimers();
    } else if (!this.wasInIsland && this.fsm.state === "home") {
      this.fsm.mouseLeft();
    }
    State.notify();
  }

  /** The island takes the keyboard, so its own shortcuts work (Mac: makeKey).
   *  It gives it back when it closes, or when the chat is left. */
  takeKeyboard() {
    void Bridge.focusWindow(true);
  }

  /** The desktop shortcut needs a desktop Mochi: none on GNOME's Wayland. */
  canLeaveIsland(): boolean {
    return this.desktop.supported;
  }

  /** The desktop shortcut (macOS DesktopMochiController.flyOutOrHome). */
  flyOutOrHome() {
    // The greeting and the drop sequence draw a Mochi of their own: he stays
    // for them, as he does for a drag (canDragOut).
    const busy = State.mode === "expanded" && (State.view === "greeting" || this.uploadActive);
    if (busy && !State.mochiOnDesktop) return;
    this.desktop.flyOutOrHome();
  }

  /** Ctrl+O / Ctrl+E go to the view on screen. */
  viewCommand(command: ViewCommand) {
    this.views.get(State.view)?.command?.(command);
  }

  // ── File drop ───────────────────────────────────────────────────────────────

  private onDragDrop(e: { type: string; paths?: string[] }) {
    if (e.type !== "over") void Bridge.log(`drag ${e.type} ${e.paths?.length ?? 0} file(s)`);
    if (State.paused) return;
    switch (e.type) {
      case "enter":
      case "over": {
        if (State.fileDragOver) return;
        State.fileDragOver = true;
        this.engine.animateMorph(1);
        // enterZone must run before the island expands, so the sequence is
        // already active by the time the view becomes `upload`.
        UploadSeq.enterZone(State.mouseInIsland.x, State.mouseInIsland.y);
        this.alert("upload");
        break;
      }
      case "leave": {
        if (!State.fileDragOver) return;
        State.fileDragOver = false;
        this.engine.animateMorph(0);
        // The island deliberately stays open: the drag session is still alive.
        UploadSeq.exitZone();
        State.notify();
        break;
      }
      case "drop": {
        State.fileDragOver = false;
        const path = e.paths?.[0];
        if (!path) {
          this.engine.animateMorph(0);
          this.setView(State.defaultView());
          return;
        }
        this.swallow(path);
        break;
      }
    }
  }

  /**
   * Mochi eats the file. Nothing here waits on the file system: the copy into
   * the inbox runs in the background and swaps the path in when it lands, so a
   * slow disk can never stall the animation — same as FileDropHandler on macOS.
   */
  private swallow(path: string) {
    const name = path.split(/[\\/]/).pop() || "file";
    State.droppedFile = { name, path };
    State.promptContext = { kind: "file", name, path };
    State.chatHistory = [];
    void Bridge.chatReset();

    UploadSeq.performDrop(State.uploadDuration);
    this.uploadTens = 0;
    this.uploadDone = false;

    this.engine.gulp();
    Sound.play("approve");
    this.engine.triggerEmote("happy");
    this.engine.animateMorph(0);

    State.uploadProgress = 0;
    this.setView("uploading");
    this.ensureRunning();

    void Bridge.ingestFile(path)
      .then((file) => {
        // Cancelled (or replaced by another drop) while the copy was running.
        if (State.droppedFile?.path !== path) return;
        State.droppedFile = { name: file.name, path: file.path };
        State.promptContext = { kind: "file", name: file.name, path: file.path };
        State.notify();
      })
      .catch((err) => {
        if (State.droppedFile?.path !== path) return;
        UploadSeq.deactivate();
        State.noteMessage = String(err).replace(/^Error:\s*/, "");
        this.engine.animateMorph(0);
        this.setView("note");
        Sound.play("error");
        window.setTimeout(() => this.setView(State.defaultView()), 2400);
      });
  }

  /** "Cancel" on the dropped file: forget it, so the chat does not pick it up. */
  private discardDrop() {
    State.droppedFile = null;
    State.promptContext = null;
    this.setView(State.defaultView());
  }

  /**
   * Sounds and view changes hung off the canvas timeline: a `tick` every 10 %,
   * the ✓ chime when the bar completes, then `choose` once Mochi has grown back.
   */
  private stepSequence() {
    const since = UploadSeq.sinceDrop();
    if (since == null) return;
    const dur = State.uploadDuration;
    const p = Math.max(0, Math.min(1, (since - PRE_PROGRESS) / dur));

    const tens = Math.floor(p * 10);
    if (tens > this.uploadTens && tens < 10) {
      this.uploadTens = tens;
      Sound.play("tick");
    }

    if (!this.uploadDone && since >= PRE_PROGRESS + dur) {
      this.uploadDone = true;
      Sound.play("approve");
      this.engine.triggerEmote("happy");
    }
    // The extra second is the grow-back, after which the choose card is up.
    if (since >= PRE_PROGRESS + dur + 1 && State.view === "uploading") {
      this.setView("choose");
    }
  }

  // ── Geometry ────────────────────────────────────────────────────────────────

  /** The closed island stays on screen (anything but "hidden"). */
  private get closedShows(): boolean {
    return closedIsland(State.settings.closedIsland) !== "hidden";
  }

  private targetSize(): { w: number; h: number; r: number } {
    if (State.mode === "hidden" && this.closedShows) {
      return { w: this.closedW, h: CLOSED_H, r: 10 };
    }
    const lyrics = this.lyricsActive();
    let { w, h } = islandSize(State.mode, State.view, State.chatHistory.length, lyrics);
    if (State.mode === "expanded" && State.view === "question" && State.pendingApproval?.questions) {
      h = QUESTION_PICKER_H;
    }
    const r = State.mode === "expanded" ? EXPANDED_CORNER : lyrics ? STAGE_CORNER : ROUNDED_CORNER;
    return { w, h, r };
  }

  private animateGeometry(shrinking: boolean) {
    const { w, h, r } = this.targetSize();
    // The destination is where the DOM lays out while the spring runs: the
    // body is built at its final size once and the shell resizes around it —
    // see applyGeometry. Miku's place is measured from the body's left edge,
    // so it moves with the body to stay where she is on screen.
    const shift = (w - this.sizeTarget.w) / 2;
    this.botCx.value += shift;
    this.botCx.target += shift;
    this.sizeTarget = { w, h, r };
    // Folding, she settles with the 340 ms curve instead of trailing out of
    // the shrinking shell; opening keeps the softer spring.
    for (const s of [this.botCx, this.botCy, this.botSize]) {
      if (shrinking) s.configure(0.3, 0.95);
      else s.configure(0.5, 0.72);
    }
    if (shrinking) {
      this.width.curveTowards(w);
      this.height.curveTowards(h);
      this.radius.curveTowards(r);
    } else {
      this.width.springTo(w);
      this.height.springTo(h);
      this.radius.springTo(r);
    }
    this.ensureRunning();
  }

  private applyGeometry() {
    const w = this.width.value;
    const hh = this.height.value;
    const r = this.radius.value;
    const t = this.sizeTarget;
    // The shell takes the animated size; the body inside keeps the final one
    // (fixed px, so only the shell lays out per frame) and stays centred. A
    // scale here stretched Miku, the text and the border out of shape.
    this.islandEl.style.width = `${w}px`;
    this.islandEl.style.height = `${hh}px`;
    this.islandEl.style.borderRadius = `0 0 ${r}px ${r}px`;
    const dx = (w - t.w) / 2;
    this.bodyEl.style.width = `${t.w}px`;
    this.bodyEl.style.height = `${t.h}px`;
    this.bodyEl.style.left = `${dx}px`;
    // While the shell is still smaller than the panel, the panel is cut to it.
    const side = Math.max(0, -dx);
    const bottom = Math.max(0, t.h - hh);
    this.clipEl.style.clipPath = side > 0.5 || bottom > 0.5
      ? `inset(0 ${side}px ${bottom}px round 0 0 ${r}px ${r}px)`
      : "";
    // These follow the island as it resizes, so they belong here rather than in
    // the state-driven DOM sync.
    this.clockEl.style.height = `${t.h}px`;
    this.greetingCanvas.style.left = `${(t.w - EXPANDED_W) / 2}px`;
    this.uploadCanvas.el.style.left = `${(t.w - EXPANDED_W) / 2}px`;

    const viewportW = window.innerWidth > 0 ? window.innerWidth : PANEL_W;
    this.notices?.place(hh);
    let rw = w;
    let rh = hh;
    if (this.notices?.noticeOn) {
      rw = Math.max(rw, NOTICE_W);
      rh = Math.max(rh, NOTICE_H);
    } else if (this.notices?.hangOn) {
      rw = Math.max(rw, this.notices.hangWidth());
      rh = hh + HANG_H;
    }
    const rect = { x: (viewportW - rw) / 2, y: 0, w: rw, h: rh };
    const p = this.pushedRect;
    if (Math.abs(p.x - rect.x) > 0.5 || Math.abs(p.w - rect.w) > 0.5 || Math.abs(p.h - rect.h) > 0.5) {
      this.pushedRect = rect;
      void Bridge.setIslandRect(rect.x, rect.y, rect.w, rect.h);
    }
  }

  /** Island rect in window coordinates (origin top-left of the 720×320 window). */
  private islandRect(): { x: number; y: number; w: number; h: number } {
    const w = this.width.value;
    const hh = this.height.value;
    const viewportW = window.innerWidth > 0 ? window.innerWidth : PANEL_W;
    return { x: (viewportW - w) / 2, y: 0, w, h: hh };
  }

  // ── Window collapse (hidden → tiny wake strip, zero polling) ────────────────

  private updateWindowCollapsed() {
    if (this.collapseTimer != null) {
      window.clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    if (State.mode === "hidden") {
      this.stopLyricsTicker();
      // Let the island finish folding, then shrink the window to it — to the
      // closed island, or to the wake strip when that shows nothing: from
      // there nothing polls the cursor at all.
      this.collapseTimer = window.setTimeout(() => {
        this.collapseTimer = null;
        if (State.mode !== "hidden") return;
        this.collapsed = true;
        this.sendCollapsedSize(true);
      }, 420);
    } else if (this.collapsed) {
      // Grow the window back before the island animates open.
      this.collapsed = false;
      this.collapsedTo = { w: 0, h: 0 };
      void Bridge.setCollapsed(false);
    }
  }

  /**
   * Mochi in the closed island now and then blinks or glances around, as he
   * does on a Mac without a notch: a few frames every few seconds, the loop
   * asleep in between. Nothing runs for the other closed islands.
   */
  private scheduleClosedLife() {
    if (this.closedLife != null) window.clearTimeout(this.closedLife);
    this.closedLife = null;
    if (State.mode !== "hidden" || closedIsland(State.settings.closedIsland) !== "mochi") {
      this.closedLook = { x: 0, y: 0 };
      return;
    }
    this.closedLife = window.setTimeout(() => {
      this.closedLife = null;
      if (State.mode !== "hidden" || State.paused) return this.scheduleClosedLife();
      if (Math.random() < 0.55) {
        this.engine.blink();
      } else {
        this.closedLook = { x: (Math.random() * 2 - 1) * 0.8, y: (Math.random() * 2 - 1) * 0.3 };
      }
      this.closedAwakeUntil = performance.now() + 700;
      this.ensureRunning();
      this.scheduleClosedLife();
    }, 2500 + Math.random() * 3500);
  }

  /** Whether the words belong on screen, asked before the island is woken for
   *  them: a hidden island is not "compact", so the usual gate cannot be used. */
  wantsLyricsPill(): boolean {
    if (!this.lyricsInIsland() || !this.lyricsShown() || !this.lyricsSong.timed.length) return false;
    if (this.lyricsFeedHold) {
      return holdStillUp(this.lyricsFeedSince, Date.now());
    }
    const track = Spotify.state.track;
    if (track == null || !looksLikeSong(track, State.settings.lyricsVideos)) return false;
    return Spotify.state.playing || this.lyricsPausedAt == null;
  }

  private lyricsActive(): boolean {
    const s = Spotify.state;
    if (State.mode !== "compact" || !this.lyricsInIsland() || !this.lyricsShown()) return false;
    if (!this.lyricsSong.timed.length) return false;
    // A feed app or a video holds the session the song was on: the words stay
    // up, frozen on the line they reached. That is a grace period for a glance
    // at another tab, not a freeze: past HOLD_MAX_MS the user is watching
    // something else, and the pill goes with the song.
    if (this.lyricsFeedHold) {
      if (holdStillUp(this.lyricsFeedSince, Date.now())) {
        this.lyricsPausedAt = null;
        return true;
      }
      return false;
    }
    if (s.track == null || !looksLikeSong(s.track, State.settings.lyricsVideos)) return false;
    // A pause keeps the pill for its grace period, exactly like the floating
    // card: a skip back is not the end of the song.
    if (s.playing) {
      this.lyricsPausedAt = null;
      return true;
    }
    this.lyricsPausedAt ??= Date.now();
    return Date.now() - this.lyricsPausedAt < HIDE_AFTER_PAUSE_MS;
  }

  private lyricsShown(): boolean {
    return State.settings.lyrics?.shown === true;
  }

  /** Lyrics draw in the top pill unless a setting says "floating". A file from
   *  before `lyrics.placement` existed carries no value there, and no value
   *  means the island, which is the default. */
  private lyricsInIsland(): boolean {
    return State.settings.lyrics?.placement !== "floating"
      && State.settings.lyricsPlacement !== "floating";
  }

  /** Fetches the words once per track and keeps the pill's three lines current. */
  private async syncLyricsPill(s: SpotifyState) {
    // State can notify before build() has made the pill (the constructor
    // subscribes first). There is nothing to draw in yet; setMode and the next
    // report come back to it.
    if (!this.lyricsPill) return;
    const track = s.track;
    if (!track || !this.lyricsInIsland() || !this.lyricsShown()) {
      this.hideLyricsPill();
      return;
    }
    // Something that is not a song has taken the session: an Instagram feed, a
    // YouTube video, a Short. A browser publishes one media session for all of
    // its tabs, so these reports alternate with the song's while it plays on.
    // Hiding at once wiped the words and let the island fold, which is what made
    // the lyrics need a manual pause/play to come back.
    //
    // The hold is a grace period, not a freeze: it covers a glance at another
    // tab while the song keeps playing. Once the other thing has been on screen
    // for HOLD_MAX_MS, the user has moved on to watching it, and the words go.
    if (!looksLikeSong(track, State.settings.lyricsVideos)) {
      this.lyricsFeedHold = true;
      this.lyricsFeedSince ??= Date.now();
      this.refreshLyricsPill();
      return;
    }
    this.lyricsFeedHold = false;
    this.lyricsFeedSince = null;
    const key = `${track.artist}\u0000${track.title}\u0000${Math.round(track.duration)}`;
    if (key === this.lyricsKey) {
      this.drawLyricsPill(s);
      return;
    }
    // A busy LRCLIB cleared this song's key a moment ago: do not ask again on
    // every tick, only once the cooldown is over.
    if (key === this.lyricsRetryKey && Date.now() < this.lyricsRetryAt) return;
    this.lyricsKey = key;
    this.lyricsTitle = track.title;
    this.lyricsArtist = track.artist;
    // A new song: the last one's cover must not stay up while this one's loads.
    this.lyricsArt = null;
    const mine = ++this.lyricsGeneration;
    const cached = cachedSong(track);
    if (!cached && this.lyricsLoading) {
      // Another track's words are on the way, and its answer will be dropped by
      // the generation check below. Asking for this one waits for that answer,
      // so the key is cleared and the next report asks again: a second of
      // skipping through an album must not leave the pill blank for good.
      this.lyricsKey = "";
      return;
    }
    this.lyricsSong = { timed: [], plain: [] };
    this.lyricsRomanized.clear();
    this.lyricsPausedAt = null;
    this.refreshLyricsPill();
    if (!cached) this.lyricsLoading = true;
    let words = cached;
    try {
      words = cached ?? await fetchSong(track);
    } catch {
      // LRCLIB unreachable: no words this time, and the next report tries again.
      this.lyricsLoading = false;
      if (mine === this.lyricsGeneration) this.lyricsKey = "";
      return;
    }
    this.lyricsLoading = false;
    if (mine !== this.lyricsGeneration) return;
    this.lyricsSong = words ?? { timed: [], plain: [] };
    this.lyricsRomanized.clear();
    if (!this.lyricsSong.timed.length) {
      // No words. A song LRCLIB has none for is settled (the page remembers the
      // miss); a busy answer is not, and clears the key so a later report asks
      // again — otherwise one 503 during a song would leave the pill blank
      // until the next track.
      if (!knownMissing(track)) {
        this.lyricsRetryKey = key;
        this.lyricsRetryAt = Date.now() + LYRICS_RETRY_MS;
        this.lyricsKey = "";
      }
      return;
    }
    this.lyricsRetryKey = "";
    this.lyricsRetryAt = 0;
    // A Japanese song's kanji need the dictionary; until it lands the lines
    // show as written, then the pill redraws itself.
    const lines = this.lyricsSong.timed.map((l) => l.text);
    if (languageOfLines(lines) === "japanese" && !japaneseReady()) {
      const ready = await ensureJapaneseTokenizer();
      if (mine !== this.lyricsGeneration) return;
      if (ready) {
        this.lyricsLanguage = "japanese";
        // Lines drawn while the dictionary loaded were read without it (kanji
        // left as written): read them again now that it is here.
        this.lyricsRomanized.clear();
        this.lyricsShownKey = "";
      }
    }
    const spoken = languageOfLines(lines);
    if (spoken !== this.lyricsLanguage) {
      this.lyricsLanguage = spoken;
      this.lyricsRomanized.clear();
    }
    this.drawLyricsPill(Spotify.state);
    this.refreshLyricsPill();
  }

  private lyricsLanguage: "japanese" | "chinese" | null = null;
  /** The title the words belong to, kept across a feed app's takeover. */
  private lyricsTitle = "";
  private lyricsArtist = "";
  /** The cover the words belong to, kept like the title while a feed app holds the session. */
  private lyricsArt: string | null = null;
  private lyricsPausedAt: number | null = null;
  private lyricsEls: {
    art: HTMLElement; artImg: HTMLImageElement; title: HTMLElement; artist: HTMLElement; album: HTMLElement;
    src: HTMLElement; miku: HTMLCanvasElement; past: HTMLElement; current: HTMLElement; next: HTMLElement;
    elapsed: HTMLElement; total: HTMLElement; bar: HTMLElement; play: HTMLElement;
  } | null = null;
  private stageStart = performance.now();

  /**
   * The song's stage (docs/mockups/notch-music.png): the cover with title,
   * artist and album, Miku singing under three spotlights on an LED floor, the
   * words, the song's clock and its buttons, and the way out to the floating card.
   */
  private buildLyricsPill() {
    if (this.lyricsEls) return this.lyricsEls;
    const artImg = h("img", { alt: "", draggable: "false" }) as HTMLImageElement;
    const art = h("div", { class: "ms-art" }, artImg);
    const title = h("div", { class: "ms-title" });
    const artist = h("div", { class: "ms-artist" });
    const album = h("div", { class: "ms-album" });
    const src = h("span", { class: "ms-src" });
    const head = h("div", { class: "ms-head" },
      art,
      h("div", { class: "ms-text" }, title, artist, album),
      src,
    );
    const miku = h("canvas", { class: "ms-miku" }) as HTMLCanvasElement;
    const stage = h("div", { class: "ms-stage" },
      h("div", { class: "ms-beam left" }), h("div", { class: "ms-beam right" }), h("div", { class: "ms-beam mid" }),
      miku,
    );
    const past = h("div", { class: "ms-line past" });
    const current = h("div", { class: "ms-line current" });
    const next = h("div", { class: "ms-line next" });
    const elapsed = h("span");
    const total = h("span");
    const bar = h("i");
    const prog = h("div", { class: "ms-prog" }, elapsed, h("div", { class: "ms-bar" }, bar), total);
    // Buttons act on the player; none of their presses may open the island's card.
    const button = (cls: string, label: string, onClick: () => void, ...kids: (Node | string)[]) => {
      const b = h("button", { class: cls, title: label }, ...kids);
      b.addEventListener("mousedown", (e) => e.stopPropagation());
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
      });
      return b;
    };
    const play = button("ms-play", t("Play"), () => {
      const st = Spotify.state;
      if (!st.running) return;
      Spotify.state = { ...st, playing: !st.playing, position: spotifyPosition(st, Date.now()), positionAt: Date.now() };
      State.notify();
      void Bridge.spotifyControl("playPause");
    });
    const ctl = h("div", { class: "ms-ctl" },
      button("ms-skip", t("Previous"), () => void Bridge.spotifyControl("previous"), svg(ICONS.backward, 14)),
      play,
      button("ms-skip", t("Next"), () => void Bridge.spotifyControl("next"), svg(ICONS.forward, 14)),
      // The way out to the floating card, where a right-click alone was before.
      button("ms-detach", t("Detach from top"), () => void Bridge.lyricsSetPlacement("floating"), `⇱ ${t("Detach lyrics")}`),
    );
    this.lyricsPill.replaceChildren(head, stage, h("div", { class: "ms-floor" }),
      h("div", { class: "ms-lyr" }, past, current, next), prog, ctl);
    this.lyricsEls = { art, artImg, title, artist, album, src, miku, past, current, next, elapsed, total, bar, play };
    return this.lyricsEls;
  }

  /** The parts that move every tick: Miku, the clock and the play button. */
  private paintStage(s: SpotifyState) {
    const els = this.lyricsEls;
    if (!els) return;
    const d = s.track?.duration ?? 0;
    const pos = Math.min(d, spotifyPosition(s, Date.now()));
    els.elapsed.textContent = formatTime(pos);
    els.total.textContent = d > 0 ? formatTime(d) : "";
    els.bar.style.width = d > 0 ? `${(pos / d) * 100}%` : "0%";
    const icon = s.playing ? "pause" : "play";
    if (els.play.dataset.icon !== icon) {
      els.play.dataset.icon = icon;
      els.play.replaceChildren(svg(s.playing ? ICONS.pause : ICONS.play, 13));
      els.play.title = s.playing ? t("Pause") : t("Play");
    }
  }

  /** Miku on the stage, one frame per screen refresh while the stage is up. */
  private stageRaf: number | null = null;
  private stageLoop = () => {
    this.stageRaf = null;
    if (this.lyricsPill.hidden || !this.lyricsEls) return;
    this.paintStageMiku(Spotify.state);
    this.stageRaf = requestAnimationFrame(this.stageLoop);
  };

  private paintStageMiku(s: SpotifyState) {
    const els = this.lyricsEls;
    if (!els) return;
    const c = els.miku;
    const x = c.getContext("2d");
    const w = c.clientWidth;
    const hh = c.clientHeight;
    if (!x || !w || !hh) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(hh * dpr)) c.height = Math.round(hh * dpr);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, c.width, c.height);
    const k = Math.min(c.width / CHIBI_W, c.height / CHIBI_H);
    x.setTransform(k, 0, 0, k, (c.width - CHIBI_W * k) / 2, c.height - CHIBI_H * k);
    const variant = resolveVariant(parseVariant(State.settings.mikuVariant), new Date());
    drawChibi(x, s.playing ? "singing" : "idle", s.playing ? (performance.now() - this.stageStart) / 1000 : 0, variant, { noShadow: true });
  }

  private drawLyricsPill(s: SpotifyState) {
    const lines = this.lyricsSong.timed;
    if (!lines.length) return;
    this.buildLyricsPill();
    this.paintStage(s);
    const index = Math.max(0, lineIndexAt(lines, Math.max(0, spotifyPosition(s, Date.now()))));
    // The stage wears the song's own title, never the name of whatever took the
    // session over: a feed app's title belongs to the feed, not to these words.
    const title = this.lyricsTitle || (s.track?.title ?? "");
    const artist = this.lyricsArtist || (s.track?.artist ?? "");
    const album = this.lyricsFeedHold ? "" : (s.track?.album ?? "");
    if (!this.lyricsFeedHold) this.lyricsArt = currentArtwork(s) ?? this.lyricsArt;
    const art = this.lyricsArt;
    // The same line (most of the song): nothing to redraw, nothing to romanize.
    const romanizeOn = State.settings.lyricsRomanize !== false;
    const key = `${this.lyricsKey}|${this.lyricsLanguage}|${index}|${title}|${album}|${romanizeOn}|${(State.settings.lyricsRomajiLangs ?? []).join(",")}|${art ? art.length : 0}`;
    if (key === this.lyricsShownKey && this.lyricsEls) return;
    this.lyricsShownKey = key;

    const els = this.buildLyricsPill();
    // The neighbours skip the instrumental gaps LRCLIB stamps: a verse's first
    // line would otherwise have an empty line above it, and a gap would leave
    // the whole stage wordless.
    const before = previousSungLine(lines, index);
    const after = nextSungLine(lines, index);
    const read = (i: number) => {
      if (i < 0 || i >= lines.length) return "";
      if (!romanizeOn) return lines[i].text;
      let text = this.lyricsRomanized.get(i);
      if (text === undefined) {
        text = romanizeMixed(lines[i].text, this.lyricsLanguage, State.settings.lyricsRomajiLangs);
        this.lyricsRomanized.set(i, text);
      }
      return text;
    };
    els.title.textContent = title;
    els.artist.textContent = artist;
    els.album.textContent = album;
    // Spotify by name; any other player (a browser tab, YouTube Music…) as "now playing".
    // (Windows builds every track id as spotify:…, so only the source says who plays it.)
    const fromSpotify = /spotify/i.test(s.track?.source ?? "");
    els.src.textContent = fromSpotify ? "SPOTIFY" : t("Now playing").toUpperCase();
    els.src.classList.toggle("spotify", fromSpotify);
    els.art.classList.toggle("has-art", !!art);
    if (art) {
      if (els.artImg.getAttribute("src") !== art) els.artImg.setAttribute("src", art);
    } else {
      els.artImg.removeAttribute("src");
    }
    els.past.textContent = read(before);
    els.current.textContent = read(index);
    els.next.textContent = read(after);
  }

  /** Shows the pill only while it belongs on screen: the island is compact. */
  private refreshLyricsPill() {
    const active = this.lyricsActive();
    const was = !this.lyricsPill.hidden;
    this.lyricsPill.hidden = !active;
    // While the words are up, the compact island does not fold on its own: the
    // pill lives inside it, and retracting the island would take it away
    // mid-song. The pointer leaving is not a stop.
    this.fsm.setHeldOpen(active);
    if (active) {
      this.drawLyricsPill(Spotify.state);
      this.startLyricsTicker();
    } else {
      this.stopLyricsTicker();
    }
    if (was !== active) this.animateGeometry(!active);
  }

  private hideLyricsPill() {
    this.lyricsKey = "";
    this.lyricsRetryKey = "";
    this.lyricsRetryAt = 0;
    this.lyricsGeneration++;
    this.lyricsSong = { timed: [], plain: [] };
    this.lyricsRomanized.clear();
    this.lyricsShownKey = "";
    this.lyricsFeedHold = false;
    this.lyricsFeedSince = null;
    this.lyricsTitle = "";
    this.lyricsArtist = "";
    this.lyricsArt = null;
    this.lyricsPausedAt = null;
    this.lyricsPill.replaceChildren();
    this.lyricsEls = null;
    this.stopLyricsTicker();
    const was = !this.lyricsPill.hidden;
    this.lyricsPill.hidden = true;
    // No words any more: the island may fold on its own timer again, starting
    // from now rather than from whenever the pointer last left it.
    this.fsm.setHeldOpen(false);
    if (was) this.animateGeometry(true);
  }

  private startLyricsTicker() {
    if (this.stageRaf == null) this.stageRaf = requestAnimationFrame(this.stageLoop);
    if (this.lyricsTicker != null) return;
    this.lyricsTicker = window.setInterval(() => {
      if (!this.lyricsActive()) {
        // The pause grace ran out, the song ended, or the player stopped:
        // refreshLyricsPill hides the pill and releases the island's hold.
        this.refreshLyricsPill();
        return;
      }
      this.drawLyricsPill(Spotify.state);
    }, LYRICS_TICK_MS);
  }

  private stopLyricsTicker() {
    if (this.stageRaf != null) cancelAnimationFrame(this.stageRaf);
    this.stageRaf = null;
    if (this.lyricsTicker == null) return;
    window.clearInterval(this.lyricsTicker);
    this.lyricsTicker = null;
  }

  /** A LINE / Discord toast Windows showed (pc_notifications.rs). */
  pcNotification(n: { app: string; title: string; body: string }) {
    void this.notices.pcNotification(n);
  }

  /** A new WhatsApp message: its card grows out of the capsule. */
  notify() {
    this.notices.whatsapp();
  }

  /** The pointer is on the folded window (Rust's `closed-hover`): the island wakes. */
  wakeFromClosed() {
    if (State.mode !== "hidden") return;
    Sound.resume();
    this.fsm.mouseEntered();
  }

  /** Tells Rust the folded window's size: the closed island's, or none (the strip). */
  private sendCollapsedSize(force = false) {
    let size = this.closedShows ? { w: this.closedW, h: CLOSED_H } : { w: 0, h: 0 };
    // The notice card, or Miku hanging under the capsule, need their room too.
    if (this.notices?.noticeOn) size = { w: Math.max(size.w, NOTICE_W + 20), h: Math.max(size.h, NOTICE_H + 12) };
    else if (this.notices?.hangOn) size = { w: Math.max(size.w, this.notices.hangWidth()), h: Math.max(size.h, CLOSED_H) + HANG_H };
    if (!force && size.w === this.collapsedTo.w && size.h === this.collapsedTo.h) return;
    this.collapsedTo = size;
    if (size.w > 0) void Bridge.setCollapsed(true, size.w, size.h);
    else void Bridge.setCollapsed(true);
  }

  /**
   * What the closed island shows, redrawn when it changes (the minute, the
   * song, the plan): a new width animates the island and, once folded,
   * resizes the window to it.
   */
  private updateClosed() {
    const style = closedIsland(State.settings.closedIsland);
    // Without a strip to click, hovering the top edge peeks at the compact island.
    this.fsm.peeks = !this.closedShows;
    const track = Spotify.state.track;
    const content: ClosedContent | null = State.mode === "hidden" || this.collapsed
      ? closedContent(style, {
        now: new Date(),
        locale: language(),
        planUsage: State.planUsage,
        music: State.spotifyPlaying && track ? { title: track.title, artist: track.artist } : null,
        weather: State.weatherBrief,
      })
      : null;
    // The equaliser moves only while a song plays; without one it lies still.
    const live = content?.eq === true && State.spotifyPlaying;
    this.closedEl.classList.toggle("live", live);
    const key = content ? `${style}|${content.text}|${content.dot ?? ""}|${content.note}|${content.eq ?? false}|${live}` : style;
    const shown = State.mode === "hidden" && this.closedShows;
    this.closedEl.classList.toggle("on", shown && content != null);
    if (key === this.closedKey) return;
    this.closedKey = key;
    this.closedText.textContent = content?.text ?? "";
    this.closedEl.classList.toggle("note", content?.note === true);
    this.closedEl.classList.toggle("synth", content?.eq === true);
    this.closedDot.style.display = content?.dot ? "" : "none";
    if (content?.dot) this.closedDot.style.background = content.dot;
    // Measured as drawn: the font and the language decide the width.
    // Miku's head always; the equaliser only while it shows (a song).
    const extras = (content?.dot ? 12 : 0) + (content?.note ? 16 : 0) + (content?.eq ? (live ? SYNTH_EXTRA : SYNTH_HEAD) : 0);
    const w = closedWidth(content ? this.closedText.scrollWidth : 0, extras);
    if (w !== this.closedW) {
      this.closedW = w;
      if (State.mode === "hidden") {
        this.animateGeometry(w < this.width.value);
        if (this.collapsed) this.sendCollapsedSize();
      }
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  private wireInput() {
    // Folded, the window is only the closed island (or the wake strip): the
    // pointer coming onto it is all there is to hear, and it wakes the island.
    const wake = () => {
      Sound.resume();
      if (State.mode === "hidden") this.fsm.mouseEntered();
    };
    this.wakeStrip.addEventListener("mouseenter", wake);
    this.root.addEventListener("mouseover", () => {
      if (this.collapsed) wake();
    });

    this.islandEl.addEventListener("mousedown", (e) => {
      Sound.resume();
      State.lastActivity = performance.now();
      // A click makes a hover-opened island an ordinary open one.
      this.fsm.userInteracted();
      // A press on Mochi may become a drag out to the desktop.
      if (e.button === 0 && this.isBotHit(e.clientX, e.clientY)) {
        this.botPress = { x: e.clientX, y: e.clientY };
      }
      // Right-click on Mochi opens the wardrobe, and closes it again.
      if (e.button === 2 && this.isBotHit(e.clientX, e.clientY)) {
        this.cancelBotHover();
        this.toggleWardrobe();
        return;
      }
      if (State.mode !== "expanded") {
        this.fsm.click();
        return;
      }
      if (this.isBotHit(e.clientX, e.clientY)) {
        this.cancelBotHover();
        this.engine.slap();
      }
    });

    // No browser menu over Mochi: his right-click is the wardrobe. Everywhere
    // else (the chat field) the webview keeps its own menu.
    this.islandEl.addEventListener("contextmenu", (e) => {
      if (this.isBotHit(e.clientX, e.clientY)) e.preventDefault();
    });

    // Dragging Mochi out of the island puts him on the desktop.
    window.addEventListener("mousemove", (e) => {
      if (this.desktop.carrying) {
        this.desktop.carry(e.clientX, e.clientY);
        return;
      }
      const press = this.botPress;
      if (!press) return;
      if (!(e.buttons & 1)) {
        this.botPress = null;
        return;
      }
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= DRAG_THRESHOLD) return;
      this.botPress = null;
      if (!this.canDragOut()) return;
      this.cancelBotHover();
      this.desktop.pickUp(e.clientX, e.clientY);
    });
    window.addEventListener("mouseup", (e) => {
      this.botPress = null;
      if (this.desktop.carrying) this.desktop.carryEnd(e.clientX, e.clientY);
    });

    // Only keys typed into the island itself land here, never Escape typed in
    // a terminal — so it may fold a waiting card away, as Escape in the notch
    // does on macOS.
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && State.mode === "expanded") {
        if (State.pendingApproval) this.foldApproval();
        else if (!State.isPinned) this.collapse();
      }
      State.lastActivity = performance.now();
    });

    void onDragDrop((e) => this.onDragDrop(e));

    // Outside Tauri (plain browser) drive the cursor from DOM events so the
    // island can be inspected with `npm run dev`.
    if (!IS_TAURI) this.followPageCursor();
  }

  /**
   * Takes the cursor from the page's own mouse events instead of Rust's poll.
   * Used where the OS has no global cursor position (Wayland): the events only
   * fire while the pointer is over the island, so leaving the window is
   * reported as a cursor far away, which is what the poll would have said.
   */
  followPageCursor() {
    window.addEventListener("mousemove", (e) => this.onCursor(e.clientX, e.clientY));
    window.addEventListener("mouseout", (e) => {
      if (e.relatedTarget == null) this.onCursor(-10_000, -10_000);
    });
  }

  /**
   * Pointer on/off the island as the compositor sees it (Linux only). Null
   * until the first report, so a platform that never sends it is not gated.
   */
  private pointerInside: boolean | null = null;

  setPointerInside(inside: boolean) {
    this.pointerInside = inside;
  }

  /** How loud the voice on the mic is right now (pill-bands): her mouth opens
   * with it while she dictates or answers. The loop stays up on `busy`. */
  setVoice(level: number) {
    this.engine.setVoiceLevel(level);
    this.ensureRunning();
  }

  /** The system's music (music-bands): the dance rides its energy and beat. */
  setMusic(bands: number[]) {
    const { rms, bass } = bandStats(bands);
    this.engine.setMusicEnergy(rms, bass);
    this.ensureRunning();
  }

  /**
   * A small ritual worth saying — a break, a milestone. It waits for a quiet
   * island: nothing interrupts an approval, and nothing shoves a chat aside.
   * When it does show, she is proud of it.
   */
  ritual(r: Ritual) {
    State.ritual = r;
    if (State.pendingApproval) return;
    if (State.mode === "expanded" && State.view !== "overview" && State.view !== State.defaultView()) return;
    this.engine.triggerEmote(r.kind === "break" ? "yawn" : "proud", 2);
    this.alert("ritual");
  }

  /** Cursor in window-logical coordinates. */
  onCursor(x: number, y: number) {
    // WebKitGTK can deliver a mousemove after the pointer has left the layer
    // surface; trusting it re-enters the island and the auto-close never runs.
    if (this.pointerInside === false) {
      x = -10_000;
      y = -10_000;
    }
    State.mouse = { x, y };
    const rect = this.islandRect();
    State.mouseInIsland = { x: x - rect.x, y: y - rect.y };

    // Windows sends no cursor position with an OLE drag, so the drop sequence is
    // fed from the Win32 cursor poll instead — it runs throughout the drag.
    if (UploadSeq.isActive && !UploadSeq.dropped) {
      UploadSeq.updateCursor(State.mouseInIsland.x, State.mouseInIsland.y);
    }

    const inIsland =
      x >= rect.x - HIT_MARGIN && x <= rect.x + rect.w + HIT_MARGIN &&
      y >= rect.y - HIT_MARGIN && y <= rect.y + rect.h + HIT_MARGIN;

    // Recorded before the state machine hears of it: a transition it makes
    // right away (open on hover) reads where the pointer is, and must not see
    // the pointer as still outside.
    const wasIn = this.wasInIsland;
    this.wasInIsland = inIsland;
    if (inIsland && !wasIn) {
      if (this.fsm.state === "miku") this.greeting.hover();
      this.fsm.mouseEntered();
    }
    if (!inIsland && wasIn) {
      this.fsm.mouseLeft();
    }

    // Bot hover → love
    const overBot = State.mode === "expanded" && State.stateOverride == null && this.isBotHit(x, y);
    if (overBot && !this.botHovering) this.botHoverIn(x, y);
    if (!overBot && this.botHovering) this.cancelBotHover();
    this.botHovering = overBot;
    if (this.botHovering) {
      const d = Math.hypot(x - this.botHoverStart.x, y - this.botHoverStart.y);
      if (d > 40) {
        this.botHoverStart = { x, y };
        this.scheduleLove();
      }
    }

    this.ensureRunning();
  }

  /** The greeting and the drop sequence draw a Mochi of their own: not that one. */
  private canDragOut(): boolean {
    if (State.mode === "hidden" || !this.desktop.canPickUp()) return false;
    return !(State.mode === "expanded" && (State.view === "greeting" || this.uploadActive));
  }

  private isBotHit(x: number, y: number): boolean {
    // Out on the desktop, the island's Mochi is invisible: nothing to hit.
    if (State.mochiOnDesktop) return false;
    const rect = this.islandRect();
    const cx = rect.x + this.botCx.value;
    const cy = rect.y + this.botCy.value;
    const radius = this.botSize.value / 2;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
  }

  private botHoverIn(x: number, y: number) {
    if (performance.now() / 1000 - this.lastLoveTime < 6) return;
    this.botHoverStart = { x, y };
    this.engine.blink();
    this.engine.tgEs = 1.08;
    Sound.play("hover");
    this.scheduleLove();
  }

  private scheduleLove() {
    if (this.botHoverTimer != null) window.clearTimeout(this.botHoverTimer);
    this.botHoverTimer = window.setTimeout(() => {
      this.botHoverTimer = null;
      if (!this.botHovering || State.stateOverride != null) return;
      if (performance.now() / 1000 - this.lastLoveTime < 6) return;
      this.lastLoveTime = performance.now() / 1000;
      this.engine.triggerEmote("love");
      Sound.play("love");
    }, 1900);
  }

  private cancelBotHover() {
    if (this.botHoverTimer != null) window.clearTimeout(this.botHoverTimer);
    this.botHoverTimer = null;
    this.engine.tgEs = 1;
  }

  /** Three slaps → dizzy + confused view for 3.3 s, then back. */
  handleDizzy() {
    this.prevViewBeforeConfused = State.view;
    State.stateOverride = "dizzy";
    this.engine.setState("dizzy");
    Sound.play("dizzy");
    this.alert("confused");
    if (this.confusedRecovery != null) window.clearTimeout(this.confusedRecovery);
    this.confusedRecovery = window.setTimeout(() => {
      this.confusedRecovery = null;
      State.stateOverride = null;
      this.engine.setState(State.effectiveState);
      if (State.view === "confused") {
        const fallback = State.defaultView();
        this.setView(this.prevViewBeforeConfused === "confused" ? fallback : this.prevViewBeforeConfused);
      }
      this.engine.triggerEmote("happy");
    }, 3300);
  }

  // ── Frame loop ──────────────────────────────────────────────────────────────

  ensureRunning() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (nowMs: number) => {
    // rAF's stamp is the frame's start, which can fall before the
    // performance.now() taken in ensureRunning: never step backwards.
    const dt = Math.max(0, Math.min(0.05, (nowMs - this.lastFrame) / 1000));
    this.lastFrame = nowMs;

    this.width.step(dt, nowMs);
    this.height.step(dt, nowMs);
    this.radius.step(dt, nowMs);
    this.applyGeometry();

    if (this.dirty) {
      this.dirty = false;
      this.syncDom();
    }

    this.updateBotTargets();
    this.botCx.step(dt);
    this.botCy.step(dt);
    this.botSize.step(dt);

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    if (greetingActive) {
      const gctx = this.greetingCanvas.getContext("2d");
      if (gctx) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (this.greetingCanvas.width !== Math.round(EXPANDED_W * dpr)) {
          this.greetingCanvas.width = Math.round(EXPANDED_W * dpr);
          this.greetingCanvas.height = Math.round(150 * dpr);
        }
        gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.greeting.draw(gctx);
      }
    } else {
      // Kept running even while the drop canvas is up, so the island's own Mochi
      // is already in the right place the moment the canvas fades out.
      this.drawBot(dt);
    }

    const uploadActive = this.uploadActive;
    if (uploadActive) this.uploadCanvas.draw(UploadSeq.frame(), nowMs / 1000);
    this.uploadCanvas.el.classList.toggle("on", uploadActive);
    this.viewsEl.classList.toggle("hidden-by-upload", uploadActive);

    tickMiniBots(dt);
    // A ticker scroll that loses its frames freezes mid-way, rows overlapping.
    const viewAnimating = this.views.get(State.view)?.tick?.(nowMs) === true;
    if (UploadSeq.isActive) this.stepSequence();
    this.updateCountdown(nowMs);

    // The weather behind the content (snow on Snow Miku, petals on Sakura, the
    // classic clean): asked every frame, so a wardrobe pick lands at once.
    // Hidden, nothing falls — the closed island is a notch, not a sky.
    const weather = State.mode === "hidden" ? "none" : ambientFor(
      State.variantPreview ?? this.variants.get(parseVariant(State.settings.mikuVariant)),
    );
    this.ambient.set(weather);
    this.ambientCanvas.classList.toggle("on", this.ambient.active);
    this.ambient.setSky(this.skyNow());
    this.ambient.step(dt);

    // Music chrome: while she dances, the island's small dots and the clock
    // glow with the beat — `--beat` for the CSS, quantised so the style write
    // happens ~40 times a second at most.
    const beat = State.mode === "hidden" ? 0 : Math.round(this.engine.beatPulse * 40) / 40;
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      this.islandEl.style.setProperty("--beat", beat.toFixed(3));
    }

    // The working session, read about twice a minute: agents at it for the
    // better part of an hour earn a mention of a break.
    if (nowMs - this.breakCheckedAt > 30_000) {
      this.breakCheckedAt = nowMs;
      const st = State.effectiveState;
      const active = !State.paused && (st === "working" || st === "thinking" || st === "searching");
      if (this.breakTracker.update(active, nowMs)) {
        this.ritual({ kind: "break", minutes: Math.round(BREAK_AFTER_MS / 60_000) });
      }
    }

    // Nothing is drawn while the island is hidden, so nothing may keep the loop
    // alive either. This used to read `... || this.engine.busy || State.mode !==
    // "hidden"`, and engine.busy is permanently true for any state with a
    // looping animation — breathing, ratelimit sweat, sleeping z's, the search
    // sweep — so a hidden island went on burning frames in exactly the states it
    // spends most of its life in. Geometry still has to finish retracting.
    const settling =
      this.width.animating || this.height.animating || this.radius.animating;
    const botMoving = !this.botCx.settled || !this.botCy.settled || !this.botSize.settled;
    // Closed, only the folding — and Mochi reaching his place in the closed island.
    // The mini bots breathe on their own, and their engines are not this one:
    // without them here, a compact island whose tasks are all "working" stopped
    // its loop and left them frozen mid-breath.
    const busy = State.mode === "hidden"
      ? settling || (closedIsland(State.settings.closedIsland) === "mochi" &&
        (botMoving || nowMs < this.closedAwakeUntil))
      : settling ||
        !this.botCx.settled || !this.botCy.settled || !this.botSize.settled ||
        greetingActive || this.engine.busy || miniBotCount() > 0 ||
        UploadSeq.isActive || viewAnimating || this.ambient.active;

    if (busy) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
      Sound.idle();
    }
  };

  private updateBotTargets() {
    let p = botPosition(State.mode, State.view, this.height.value, State.uploadProgress);
    // The closed island with Mochi in it, as on a Mac without a notch.
    if (State.mode === "hidden" && closedIsland(State.settings.closedIsland) === "mochi") {
      // The synth strip: her head at the left end, the equaliser and text after it.
      p = { cx: SYNTH_BOT_X, cy: this.height.value / 2, diameter: CLOSED_BOT_D, opacity: 1 };
    }
    this.botCx.target = p.cx;
    this.botCy.target = p.cy;
    this.botSize.target = p.diameter / 0.6;

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    // The drop canvas draws its own Mochi; two of them would overlap. Out on the
    // desktop, he isn't here at all.
    const away = State.mochiOnDesktop;
    const deck = State.mode === "expanded" && State.view === "overview";
    const visible = p.opacity > 0 && !greetingActive && !this.uploadActive && !away && !deck;
    this.botCanvas.style.opacity = visible ? "1" : "0";

    if (State.mode === "expanded" && State.view !== "uploading" && !greetingActive && !this.uploadActive && !away && !deck) {
      const d = p.diameter;
      const color = botGlowColor(State.effectiveState);
      const opacity = botGlowOpacity(State.effectiveState);
      const cx = this.botCx.value;
      const cy = this.botCy.value;
      // A still frame writes nothing: the glow only changes with the colour,
      // the size, the place or the state's opacity.
      const key = `${color}|${d}|${cx}|${cy}|${opacity}`;
      if (key !== this.glowKey || !this.glowVisible) {
        this.glowKey = key;
        this.glowVisible = true;
        this.botGlow.style.display = "block";
        this.botGlow.style.width = `${d * 2.2}px`;
        this.botGlow.style.height = `${d * 2.2}px`;
        this.botGlow.style.left = `${cx - d * 1.1}px`;
        this.botGlow.style.top = `${cy - d * 1.1}px`;
        this.botGlow.style.background = `radial-gradient(circle, ${color} 0%, transparent 62%)`;
        this.botGlow.style.opacity = String(opacity);
      }
    } else if (this.glowVisible) {
      this.glowVisible = false;
      this.botGlow.style.display = "none";
    }
  }

  private drawBot(dt: number) {
    const size = this.botSize.value;
    const w = Math.max(1, Math.round(size));
    const hCss = w + BOT_OVERHANG;
    const wCss = w + BOT_SIDE * 2;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Drawn at the current ratio, so a bitmap sized for another monitor's
    // would show Mochi too big and cut, or too small.
    if (this.canvasPx !== w || this.canvasDpr !== dpr) {
      this.canvasPx = w;
      this.canvasDpr = dpr;
      this.botCanvas.width = Math.round(wCss * dpr);
      this.botCanvas.height = Math.round(hCss * dpr);
      this.botCanvas.style.width = `${wCss}px`;
      this.botCanvas.style.height = `${hCss}px`;
    }
    this.botCanvas.style.left = `${this.botCx.value - wCss / 2}px`;
    this.botCanvas.style.top = `${this.botCy.value - BOT_OVERHANG / 2 - hCss / 2}px`;

    const ctx = this.botCtx ?? (this.botCtx = this.botCanvas.getContext("2d"));
    if (!ctx) return;

    const focus = State.focusTask;
    // A new Miku waits: over an idle or sleeping Mochi, the blue and the arrow
    // badge (whats-new.ts). Anything Mochi has to say comes first.
    this.engine.setUpdateHint(this.updateHintOn() ? UPDATE_BLUE_RGB : null);
    // While a plan card is open Mochi wears the plan's colour, like its pill.
    this.engine.bodyColor = planCardOpen()
      ? hexToRGB(openPlanColor())
      : this.engine.showsUpdateHint
        ? UPDATE_BLUE_RGB
        : focus?.isIntegration
          ? hexToRGB(focus.color)
          : null;
    this.engine.particleOverhang = BOT_OVERHANG;
    this.engine.lookX = this.lookX();
    this.engine.lookY = this.lookY();
    if (this.engine.morph > 0.3) {
      this.engine.slotHTarget = State.fileDragOver ? 0.2 : 0;
    } else {
      this.engine.slotHTarget = 0;
      if (this.engine.morph < 0.05) {
        this.engine.slotH = 0;
        this.engine.slotHVel = 0;
      }
    }
    // Only the main Mochi is dressed — the one of the main tool's pill (Settings →
    // Active pills): a focused integration pill shows its own colours, unless
    // the wardrobe is open (BotCanvasView.showOutfit, macOS).
    // In the wardrobe the hovered outfit swaps in at once, without the drop-in.
    const inWardrobe = State.mode === "expanded" && State.view === "wardrobe";
    const mainFocused = State.focusId == null || State.focusId === State.mainPillId;
    const showOutfit = mainFocused || State.mode !== "expanded" || inWardrobe;
    const outfit = State.wardrobePreview ?? this.seasons.get(parseOutfit(State.settings.mochiOutfit));
    this.engine.setOutfit(showOutfit ? outfit : "none", !inWardrobe);
    // Which Miku: the wardrobe's choice, or the season's. Asked every frame, so
    // picking one in the wardrobe shows at once.
    this.engine.setVariant(State.variantPreview
      ?? this.variants.get(parseVariant(State.settings.mikuVariant)));
    // Dances while music plays: always in the compact island, expanded only on
    // the music pill's card (BotCanvasView, macOS). Asked every frame.
    this.engine.setDancing(islandDances({
      music: State.spotifyPlaying,
      state: State.effectiveState,
      mode: State.mode,
      view: State.view,
      focusId: State.focusTask?.id,
    }));
    // The system-audio watch follows the same rule: on while music plays and a
    // dance is welcome, off the moment it is not (music.rs runs one capture).
    const watchOn = desktopDances(State.spotifyPlaying, State.effectiveState) && !State.paused;
    if (watchOn !== this.musicWatch) {
      this.musicWatch = watchOn;
      void Bridge.setMusicWatch(watchOn);
    }

    this.engine.update(dt);
    // Cleared in device pixels, the whole canvas. At a fractional scale (150 %)
    // the canvas is a whole number of pixels but `hCss * dpr` is not: clearing
    // in CSS units left the last row half-cleared, and whatever once passed
    // through it (a hat in a roll) piled up there into a coloured bar.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.botCanvas.width, this.botCanvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, BOT_SIDE * dpr, 0);
    ctx.save();
    this.engine.applyDance(ctx, w, hCss);
    this.engine.draw(ctx, w, hCss);
    ctx.restore();
  }

  /** BotCanvasView.lookX / lookY — tanh of the distance to the bot. */
  private lookX(): number {
    // In the closed island the cursor isn't followed: he looks around by himself.
    if (State.mode === "hidden") return this.closedLook.x;
    const rect = this.islandRect();
    const botScreenX = rect.x + this.botCx.value;
    return Math.tanh((State.mouse.x - botScreenX) / 260);
  }

  private lookY(): number {
    if (State.mode === "hidden") return this.closedLook.y;
    return -Math.tanh((State.mouse.y - this.botCy.value) / 200);
  }

  private updateCountdown(nowMs: number) {
    // The state machine's own deadline, so the bar follows an auto-close delay
    // edited while the countdown runs.
    const dueAt = this.fsm.homeCollapseDueAt;
    if (State.mode !== "expanded" || State.isPinned || dueAt == null) {
      this.countdown.style.width = "0px";
      return;
    }
    const autoClose = this.fsm.homeToPetitDelay;
    const windowS = Math.min(10, autoClose * 0.6);
    const remaining = (dueAt - nowMs) / 1000;
    this.countdown.style.width =
      remaining < windowS ? `${Math.max(0, clamp(remaining / windowS, 0, 1) * 160)}px` : "0px";
  }

  // ── DOM sync ────────────────────────────────────────────────────────────────

  private syncDom() {
    const expanded = State.mode === "expanded";
    const greetingActive = expanded && State.view === "greeting";

    const live = expanded && !greetingActive;
    this.contentEl.style.opacity = live ? "1" : "0";
    // While the drop sequence owns the body its buttons are painted on the canvas
    // underneath, so only the header may keep taking clicks up here.
    this.contentEl.style.pointerEvents = live && !this.uploadActive ? "auto" : "none";
    this.header.el.style.pointerEvents = live ? "auto" : "none";
    this.greetingCanvas.style.display = greetingActive ? "block" : "none";

    // Leaving the greeting, however it ends, lets its sound fade out.
    if (this.greetingShown && !greetingActive) this.greeting.leave();
    this.greetingShown = greetingActive;
    // A wardrobe try-on never outlives the wardrobe.
    if (State.wardrobePreview && !(expanded && State.view === "wardrobe")) State.wardrobePreview = null;

    // The deck has its own bar on top; the island's header steps aside for it.
    this.islandEl.dataset.view = State.view;
    this.header.sync();
    for (const [name, view] of this.views) {
      const on = name === State.view;
      view.el.classList.toggle("on", on);
      if (on) view.sync();
    }

    // The chat is the only view with a text field, so it is the only time the
    // island is allowed to take keyboard focus.
    if (this.lastSyncedView !== State.view) {
      const wasChat = this.lastSyncedView === "prompt";
      this.lastSyncedView = State.view;
      if (State.view === "prompt") {
        void Bridge.focusWindow(true);
        window.setTimeout(() => this.views.get("prompt")?.focus?.(), 120);
      } else if (wasChat) {
        void Bridge.focusWindow(false);
      }
    }

    // Compact Claude plan indicator
    const showPlan = claudeCompactPillVisible();
    this.compactPlan.style.opacity = showPlan ? "1" : "0";
    this.compactPlan.style.pointerEvents = showPlan ? "auto" : "none";
    if (showPlan) {
      // Nothing else lives on the right of the compact island any more, so the
      // gauge keeps a fixed inset instead of dodging the mini grid.
      this.compactPlan.style.right = "20px";
      const pct = dominantPct(State.planUsage);
      const color = planColor(pct);
      this.compactPlan.style.setProperty("--plan", color);
      this.compactPlanLabel.textContent = pct != null ? `${Math.round(pct)}%` : "—";
    }

    this.updateClock();

    syncMiniBotStates(State.tasks);
    this.fsm.quickReturn = this.wantsLyricsPill();
    this.engine.setState(State.effectiveState);
  }

  /** The clock sits in the middle of the compact island, where the notch is on a Mac. */
  private updateClock() {
    this.updateClosed();
    this.notices?.sync();
    const on = State.mode === "compact" && State.settings.showClock;
    this.clockEl.style.opacity = on ? "1" : "0";
    // The compact island is only as wide as the notch now: when the plan
    // gauge takes the right side, the clock yields to it instead of overlapping.
    this.clockEl.style.right = claudeCompactPillVisible() ? "86px" : "56px";
    if (!on) return;
    const now = new Date();
    const date = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const text = `${date}  ${time}`;
    if (this.clockEl.textContent !== text) this.clockEl.textContent = text;
  }

  /** Applies settings coming from Rust at boot. */
  applySettings() {
    // The closed island may have changed: what it shows, or whether it shows.
    this.closedKey = "";
    this.updateClosed();
    if (State.mode === "hidden") {
      this.animateGeometry(true);
      if (this.collapsed) this.sendCollapsedSize();
    }
    this.scheduleClosedLife();
    Sound.setEnabled(State.settings.soundEnabled);
    Sound.setVolume(State.settings.soundVolume);
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.fsm.openOnHover = State.settings.openOnHover;
    State.notify();
    // ponytail: one timer for the life of the window; a minute is the clock's finest tick.
    this.clockTimer ??= window.setInterval(() => this.updateClock(), 10_000);
  }

  get panelSize() {
    return { w: PANEL_W, h: PANEL_H };
  }

  get chatHeight() {
    return chatPromptHeight(State.chatHistory.length);
  }
}
