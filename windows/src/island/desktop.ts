// Mochi on the desktop, island side: runs his life cycle (the controller in
// mochi/desktop-logic.ts) against the real app, tells the desktop window what
// to show, and handles the drag out of the island. The window itself lives in
// src-tauri/src/desktop.rs and draws him in src/desktop/main.ts.

import { Bridge, emitToWindow, onEvent, type DesktopMode } from "../core/bridge";
import type { BotEmoteName } from "../core/layout";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { desktopDances } from "../core/spotify";
import {
  DESKTOP_EVENTS, DesktopMochiController, alertActive, batteryReaction,
  type BatteryReading, type DesktopSnapshot,
} from "../mochi/desktop-logic";
import { SeasonCache, VariantCache, parseOutfit, parseVariant } from "../mochi/wardrobe";

/** Label of the desktop Mochi's window (desktop.rs LABEL). */
const WINDOW = "mochi";

/** What the life cycle needs from the island. */
export interface DesktopHost {
  /** Shows the island (compact) if it is hidden. */
  reveal(): void;
  /** Right-click on the desktop Mochi: the wardrobe, or back. */
  wardrobeFromDesktop(): void;
  /** Three pokes on the desktop Mochi. */
  dizzyFromDesktop(): void;
}

export class DesktopLink {
  mode: DesktopMode = "off";
  readonly controller: DesktopMochiController;

  /** The pointer is dragging Mochi out of the island. */
  carrying = false;

  /** The last battery reading he reacted to, so each change reacts once. */
  private battery: BatteryReading | null = null;

  private seasons = new SeasonCache();
  /** Which Miku on the desktop: the same choice the island draws. */
  private variants = new VariantCache();
  private pushed = "";
  private pendingCarry: { x: number; y: number } | null = null;
  private carryFrame = false;
  private host: DesktopHost;

  constructor(host: DesktopHost) {
    this.host = host;
    this.controller = new DesktopMochiController({
      flyOut: async (anywhere) => (await Bridge.desktopFlyOut(anywhere)) ?? false,
      flyHome: async (forget) => (await Bridge.desktopFlyHome(forget)) ?? true,
      setAway: (away) => {
        State.mochiOnDesktop = away;
        State.notify();
      },
      emote: (emote: BotEmoteName, duration = 1.8) =>
        void emitToWindow(WINDOW, DESKTOP_EVENTS.emote, { emote, duration }),
      play: (sound) => Sound.play(sound),
      alertActive: () => alertActive(State),
      revealIsland: () => {
        if (State.mode === "hidden") this.host.reveal();
      },
      later: (fn, ms) => void window.setTimeout(fn, ms),
    });
  }

  /** False where windows can't be placed (GNOME on Wayland): he stays in the island. */
  get supported(): boolean {
    return this.mode !== "off";
  }

  async init() {
    const info = await Bridge.desktopInfo();
    if (!info || info.mode === "off") return;
    this.mode = info.mode;
    this.controller.enabled = info.onDesktop;

    await onEvent<{ from: "island" | "desktop"; home: boolean }>(DESKTOP_EVENTS.dropped, (e) =>
      this.onDropped(e.from, e.home),
    );
    await onEvent<null>(DESKTOP_EVENTS.home, () => void this.controller.flyHome());
    await onEvent<null>(DESKTOP_EVENTS.wardrobe, () => this.host.wardrobeFromDesktop());
    await onEvent<null>(DESKTOP_EVENTS.dizzy, () => this.host.dizzyFromDesktop());
    // The battery, whatever the System pill is doing (system_health.rs).
    await onEvent<BatteryReading | null>("battery", (b) => this.onBattery(b));
    // The window's page (re)loaded: it knows nothing yet.
    await onEvent<null>(DESKTOP_EVENTS.ready, () => {
      this.pushed = "";
      this.push();
    });

    State.subscribe(() => this.sync());
    this.sync();
  }

  /** The launch greeting is over: back to his spot if that is where he lives. */
  launch() {
    if (this.supported) void this.controller.launchFlyIfNeeded();
  }

  /**
   * The desktop shortcut: out to his spot, or home. Not in the middle of a
   * drag out of the island — the drop decides that one.
   */
  flyOutOrHome() {
    if (!this.supported || this.carrying) return;
    void this.controller.flyOutOrHome();
  }

  // ── Drag out of the island ──────────────────────────────────────────────────

  /** Whether Mochi can be picked up from the island right now. */
  canPickUp(): boolean {
    return this.supported && !State.paused && !State.mochiOnDesktop && this.controller.phase === "home";
  }

  /** (x, y): the pointer, island-window coordinates. */
  pickUp(x: number, y: number) {
    this.carrying = true;
    State.mochiOnDesktop = true;
    State.notify();
    void Bridge.desktopPickUp(x, y).then((ok) => {
      if (ok) return;
      this.carrying = false;
      State.mochiOnDesktop = false;
      State.notify();
    });
  }

  /** The pointer moved during the drag. Windows carries him from Rust. */
  carry(x: number, y: number) {
    if (!this.carrying || this.mode === "poll") return;
    this.pendingCarry = { x, y };
    if (this.carryFrame) return;
    this.carryFrame = true;
    requestAnimationFrame(() => {
      this.carryFrame = false;
      const p = this.pendingCarry;
      this.pendingCarry = null;
      if (p && this.carrying) void Bridge.desktopCarry(p.x, p.y);
    });
  }

  /** The button went up. On Windows the cursor poll has seen it already. */
  carryEnd(x: number, y: number) {
    if (!this.carrying || this.mode === "poll") return;
    this.pendingCarry = null;
    void Bridge.desktopCarryEnd(x, y);
  }

  private onDropped(from: "island" | "desktop", home: boolean) {
    if (from === "island") {
      this.carrying = false;
      if (home) {
        // Dropped back on the island: he is simply there again.
        State.mochiOnDesktop = false;
        State.notify();
      } else {
        this.controller.installed();
      }
    } else if (home) {
      void this.controller.flyHome();
    }
  }

  // ── State → desktop window ──────────────────────────────────────────────────

  private sync() {
    this.controller.updateAlert(alertActive(State));
    this.controller.updateState(State.effectiveState);
    this.push();
  }

  /**
   * `battery` (system_health.rs): one event a minute at most, and only when the
   * reading actually changed. The charger going in is good news he can show;
   * the battery dropping to the low mark is a startle. Both are edges — each
   * happens once as the reading crosses, not on every event.
   */
  private onBattery(next: BatteryReading | null) {
    const reaction = batteryReaction(this.battery, next);
    // Remembering only a real reading keeps the first one a baseline, not a
    // change: he must not jump the moment Miku starts.
    if (next && Number.isFinite(next.pct)) this.battery = next;
    if (!reaction) return;
    // Only on the desktop: in the island he is drawn by the island's own page,
    // which would need its own reaction (the desktop window is not even open).
    if (this.controller.phase !== "onDesktop") return;
    void emitToWindow(WINDOW, DESKTOP_EVENTS.emote, {
      emote: reaction,
      duration: reaction === "surprised" ? 1.8 : 2.2,
    });
  }

  private push() {
    const snapshot: DesktopSnapshot = {
      state: State.effectiveState,
      outfit: State.wardrobePreview ?? this.seasons.get(parseOutfit(State.settings.mochiOutfit)),
      variant: this.variants.get(parseVariant(State.settings.mikuVariant)),
      soundEnabled: State.settings.soundEnabled,
      soundVolume: State.settings.soundVolume,
      paused: State.paused,
      dancing: desktopDances(State.spotifyPlaying, State.effectiveState),
    };
    const key = JSON.stringify(snapshot);
    if (key === this.pushed) return;
    this.pushed = key;
    void emitToWindow(WINDOW, DESKTOP_EVENTS.state, snapshot);
  }
}
