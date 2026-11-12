// The desktop Mochi's own window (mochi.html): draws him, and turns clicks and
// drags on him into pokes, flights home, the wardrobe and a new spot. Port of
// DesktopBotView + the mouse half of DesktopMochiController (DesktopMochi.swift).
//
// What he shows comes from the island (DESKTOP_EVENTS.state), where he is from
// Rust. The page draws only while the window is on screen, at 30 fps awake
// like the Mac, and a few frames a second asleep — with no cursor polling at
// all while he sleeps.

import { Bridge, emitToWindow, onEvent, type DesktopMode } from "../core/bridge";
import { reducedMotion } from "../core/anim";
import type { BotEmoteName } from "../core/layout";
import { Sound } from "../core/sound";
import { BotEngine } from "../mochi/engine";
import { voiceLevel, bandStats } from "../mochi/music";
import { DEFAULT_VARIANT } from "../mochi/variants";
import {
  DESKTOP_EVENTS, DOUBLE_CLICK_MS, DRAG_THRESHOLD, IDLE_ANTIC_AFTER_MS, PANEL_SIZE, agentActive, freeForAntics,
  gaze, idleAntic, isOverBody, layerDragTopLeft, lookOrigin, nextAnticDelay, pointerDistance, shouldSleep, timeMood,
  windowDragTopLeft, type DesktopSnapshot, type Point,
} from "../mochi/desktop-logic";

const ISLAND = "island";

/**
 * Width Mochi is drawn at. The engine's body radius is 0.3 × width, so this
 * gives the 28.8 px body the hit test uses, and leaves room around him for
 * hats, hands and hearts inside the 120 px window.
 */
const DRAW_W = PANEL_SIZE * 0.8;
const SIDE = (PANEL_SIZE - DRAW_W) / 2;
/** Frame pacing: TimelineView(minimumInterval: 1/30) awake; asleep, barely. */
const AWAKE_FRAME_MS = 1000 / 30;
const ASLEEP_FRAME_MS = 250;
/** How often the clock is read for the time of day: a mood lasts an hour. */
const MOOD_CHECK_MS = 5 * 60 * 1000;

class DesktopMochi {
  private engine = new BotEngine();
  private canvas: HTMLCanvasElement;
  private mode: DesktopMode = "off";

  private snap: DesktopSnapshot = {
    state: "idle", outfit: "none", variant: DEFAULT_VARIANT,
    soundEnabled: true, soundVolume: 0.12, paused: false, dancing: false,
  };

  private visible = false;
  private asleep = false;
  /** Whether the island has told us anything yet. */
  private informed = false;
  private lastAgentActive = performance.now();
  /** Pointer in window coordinates, and when the page last heard of it. */
  private cursor: Point | null = null;
  private lastPointer = -Infinity;

  private timer: number | null = null;
  private lastDraw = 0;

  /** The clock's own timers: his time-of-day mood, and the idle antics. */
  private moodTimer: number | null = null;
  /** The morning wave is a greeting, not a tic: once a day. */
  private morningGreeted: string | null = null;
  private anticTimer: number | null = null;
  /**
   * While an antic has his eyes away from the pointer, the frame loop must not
   * snap them back: the cursor is the ordinary rule, this is the exception.
   */
  private driftingUntil = 0;

  /** Canvas offset inside the window: non-zero only in a layer-shell drag. */
  private offset: Point = { x: 0, y: 0 };
  private press: { client: Point; screen: Point } | null = null;
  private dragging = false;
  /** Window's top-left corner when the drag began (mode's space). */
  private dragOrigin: Point | null = null;
  private dragTopLeft: Point | null = null;
  private moveFrame = false;
  private pokeTimer: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const dpr = this.dpr();
    canvas.width = Math.round(PANEL_SIZE * dpr);
    canvas.height = Math.round(PANEL_SIZE * dpr);
    this.engine.particleOverhang = 0;
    this.engine.setState("idle", true);
    // Three pokes: dizzy, and the island shows the confused view (as on macOS).
    this.engine.onDizzy = () => void emitToWindow(ISLAND, DESKTOP_EVENTS.dizzy);
    this.wireInput();
  }

  async start() {
    void Sound.preload();
    const info = await Bridge.desktopInfo();
    if (info) this.mode = info.mode;

    await onEvent<DesktopSnapshot>(DESKTOP_EVENTS.state, (s) => this.onSnapshot(s));
    await onEvent<{ emote: BotEmoteName; duration: number }>(DESKTOP_EVENTS.emote, (e) => {
      this.lastAgentActive = performance.now();
      this.wake();
      // Anticipation before the startle: on a surprised emote she first whips
      // her eyes up toward the island, where the alert card stands, then
      // reacts. Disney's old rule — look, then jump.
      if (e.emote === "surprised") {
        this.engine.glance(0.35, -0.85, 0.18);
        window.setTimeout(() => this.engine.triggerEmote("surprised", e.duration), 180);
      } else {
        // A landing after a Windows poll-drag arrives as the happy emote:
        // she puffs the dust where she set down.
        if (e.emote === "happy" && performance.now() < this.justDraggedUntil) this.engine.puff();
        this.engine.triggerEmote(e.emote, e.duration);
      }
      this.schedule();
    });
    await onEvent<Point>(DESKTOP_EVENTS.cursor, (p) => this.notePointer(p));
    // She is on the mic (dictation, « OK Miku »): the mouth rides the voice.
    await onEvent<number[]>("pill-bands", (bands) => {
      this.engine.setVoiceLevel(voiceLevel(bands));
      this.lastAgentActive = performance.now();
      this.schedule();
    });
    // The system's music (music.rs): the dance rides the song's energy and beat.
    await onEvent<number[]>("music-bands", (bands) => {
      const { rms, bass } = bandStats(bands);
      this.engine.setMusicEnergy(rms, bass);
      this.lastAgentActive = performance.now();
      this.schedule();
    });
    await onEvent<boolean>(DESKTOP_EVENTS.visible, (on) => this.setVisible(on));
    await onEvent<string>(DESKTOP_EVENTS.flight, (kind) => {
      // He fades in on the way out of the island (alphaValue 0 → 1 on macOS).
      if (kind !== "out") return;
      this.canvas.style.transition = "none";
      this.canvas.style.opacity = "0";
      void this.canvas.offsetWidth;
      this.canvas.style.transition = "";
      this.canvas.style.opacity = "1";
    });
    await emitToWindow(ISLAND, DESKTOP_EVENTS.ready);

    // A life of his own, independent of what the island reports: the hour's
    // mood, and a small antic now and then while nothing needs him.
    this.startMoodClock();
    this.scheduleAntic();
  }

  // ── State ───────────────────────────────────────────────────────────────────

  private onSnapshot(s: DesktopSnapshot) {
    this.snap = s;
    this.informed = true;
    Sound.setEnabled(s.soundEnabled);
    Sound.setVolume(s.soundVolume);
    this.engine.setVariant(s.variant);
    if (agentActive(s.state)) this.lastAgentActive = performance.now();
    if (!this.asleep) this.engine.setState(s.state);
    this.updateSleep(performance.now());
    this.schedule();
  }

  private setVisible(on: boolean) {
    this.visible = on;
    if (on) {
      // The two pages may have started in either order: ask again if needed.
      if (!this.informed) void emitToWindow(ISLAND, DESKTOP_EVENTS.ready);
      // Landing counts as something going on: he looks around for a while.
      this.lastAgentActive = performance.now();
      this.asleep = false;
      this.engine.setState(this.snap.state, true);
      this.engine.setOutfit(this.snap.outfit, false);
      this.engine.setVariant(this.snap.variant);
      this.schedule();
      return;
    }
    this.cancelPoke();
    this.press = null;
    this.dragging = false;
    this.setOffset({ x: 0, y: 0 });
    if (this.timer != null) window.clearTimeout(this.timer);
    this.timer = null;
    Sound.idle();
  }

  private updateSleep(now: number) {
    if (!this.visible) return;
    // Dancing keeps him up: asleep he would bounce at a few frames a second.
    if (this.snap.dancing && !this.snap.paused) this.lastAgentActive = now;
    const distance = pointerDistance(this.mode === "poll", this.cursor, now - this.lastPointer);
    const sleep =
      !this.dragging &&
      (this.snap.paused || shouldSleep((now - this.lastAgentActive) / 1000, distance));
    if (sleep === this.asleep) return;
    this.asleep = sleep;
    this.engine.setState(sleep ? "sleeping" : this.snap.state);
    // Asleep, Rust stops the cursor poll; his whole little window then listens
    // for the pointer, and the first move over it wakes him.
    void Bridge.desktopSetAsleep(sleep);
    if (sleep) Sound.idle();
    this.schedule();
  }

  private wake() {
    if (!this.asleep) return;
    this.updateSleep(performance.now());
  }

  // ── A life of his own ───────────────────────────────────────────────────────
  //
  // Two clocks that have nothing to do with the island: the hour, which decides
  // his mood, and the quiet moments, which he fills with a small antic. Both
  // are quiet by design — a mascot that moves constantly is a mascot you turn
  // off.

  /** Reads the hour every five minutes and reacts when it changes. */
  private startMoodClock() {
    if (this.moodTimer != null) window.clearInterval(this.moodTimer);
    const tick = () => this.hourChanged();
    tick();
    this.moodTimer = window.setInterval(tick, MOOD_CHECK_MS);
  }

  private hourChanged() {
    if (!this.visible || this.asleep) return;
    const now = new Date();
    const mood = timeMood(now.getHours());
    // A morning greeting is once a day, not every five minutes all morning.
    const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (mood === "happy" && this.morningGreeted !== today) {
      this.morningGreeted = today;
      // A wave: the same happy arc he gives a finished task, a little longer.
      this.engine.triggerEmote("happy", 2.4);
      this.lastAgentActive = performance.now();
      this.schedule();
      return;
    }
    // Late at night he settles down by himself. This is a mood, not sleep: the
    // ordinary sleep rules still decide that (updateSleep), so the pointer
    // near him or a task running brings him straight back.
    if (mood === "sleeping" && !this.snap.dancing) {
      this.engine.triggerEmote("yawn", 2.2);
      this.schedule();
      return;
    }
    // The after-lunch dip, now and then rather than every check.
    if (mood === "yawn" && Math.random() < 0.35) {
      this.engine.triggerEmote("yawn", 1.8);
      this.schedule();
    }
  }

  /** Plans the next quiet-moment antic. */
  private scheduleAntic() {
    if (this.anticTimer != null) window.clearTimeout(this.anticTimer);
    this.anticTimer = window.setTimeout(() => {
      this.anticTimer = null;
      this.maybeAntic();
      this.scheduleAntic();
    }, nextAnticDelay(Math.random));
  }

  private maybeAntic() {
    // The system asks for less motion: his quiet-moment antics stay off.
    if (reducedMotion()) return;
    const idleFor = performance.now() - this.lastAgentActive;
    const free = freeForAntics({
      visible: this.visible,
      asleep: this.asleep,
      dancing: this.snap.dancing,
      paused: this.snap.paused,
      dragging: this.dragging,
    });
    // Sleepy hours: his antics would look like a second, wrong sleep.
    if (!free || idleFor < IDLE_ANTIC_AFTER_MS) return;
    const antic = idleAntic(Math.random);
    switch (antic) {
      // Not an emote: the eyes drift away for a moment. No emote would be right
      // here, and the eyes are what read as "looking around". `driftingUntil`
      // holds it, since draw() puts the eyes back on the pointer every frame.
      case "lookDrift": {
        this.engine.lookX = (Math.random() - 0.5) * 1.6;
        this.engine.lookY = (Math.random() - 0.5) * 0.8;
        this.driftingUntil = performance.now() + 1800;
        window.setTimeout(() => {
          this.driftingUntil = 0;
        }, 1800);
        this.schedule();
        return;
      }
      case "wink":
        this.engine.triggerEmote("wink", 1.0);
        break;
      case "proud":
        this.engine.triggerEmote("proud", 1.6);
        break;
      case "yawn":
        this.engine.triggerEmote("yawn", 1.8);
        break;
    }
    this.schedule();
  }

  /** Pointer in window coordinates: his eyes, and waking up. The first time
   * the pointer finds her after a while away, she greets it with widened eyes. */
  private hoverBody = false;
  private lastNotice = 0;
  private notePointer(p: Point) {
    this.cursor = p;
    this.lastPointer = performance.now();
    if (this.asleep) this.wake();
    const now = performance.now();
    if (this.dragging) this.trail();
    const over = isOverBody(p);
    if (over && !this.hoverBody && now - this.lastNotice > 8000) {
      this.lastNotice = now;
      this.engine.notice();
    }
    this.hoverBody = over;
    this.schedule();
  }

  // ── Frames ──────────────────────────────────────────────────────────────────

  private schedule() {
    if (this.timer != null || !this.visible) return;
    const wait = this.asleep ? ASLEEP_FRAME_MS : AWAKE_FRAME_MS;
    const due = Math.max(0, this.lastDraw + wait - performance.now());
    this.timer = window.setTimeout(() => {
      // Awake, frames line up with the display; asleep, a timer is enough.
      if (this.asleep) {
        this.timer = null;
        this.frame(performance.now());
      } else {
        requestAnimationFrame((t) => {
          this.timer = null;
          this.frame(t);
        });
      }
    }, due);
  }

  private frame(now: number) {
    if (!this.visible) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastDraw) / 1000));
    this.lastDraw = now;
    this.updateSleep(now);
    this.draw(dt, now);
    this.schedule();
  }

  private draw(dt: number, now: number) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const engine = this.engine;
    // Her little sounds come from where she stands.
    engine.pan = this.pan();
    engine.setOutfit(this.snap.outfit, true);
    if (!this.asleep) {
      // Windows: the global cursor. Linux: only while the pointer is over him.
      const fresh = this.mode === "poll" || now - this.lastPointer < 1500;
      // An antic or an anticipation glance may have sent his eyes somewhere
      // else for a moment: that wins over the pointer, or it would last a
      // single frame.
      if (now >= this.driftingUntil && now >= engine.glanceUntil) {
        const g = this.cursor && fresh ? gaze(lookOrigin(0, 0), this.cursor) : { lookX: 0, lookY: 0 };
        engine.lookX = g.lookX;
        engine.lookY = g.lookY;
      }
    }
    // Dances while Spotify plays, by the compact island's rules.
    engine.setDancing(this.snap.dancing && !this.asleep);
    engine.update(dt);
    const dpr = this.dpr();
    // Dragged onto a monitor of another scale, the bitmap follows the ratio.
    if (this.canvas.width !== Math.round(PANEL_SIZE * dpr)) {
      this.canvas.width = Math.round(PANEL_SIZE * dpr);
      this.canvas.height = Math.round(PANEL_SIZE * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, SIDE * dpr, 0);
    ctx.clearRect(-SIDE, 0, PANEL_SIZE, PANEL_SIZE);
    ctx.save();
    engine.applyDance(ctx, DRAW_W, PANEL_SIZE);
    engine.draw(ctx, DRAW_W, PANEL_SIZE);
    ctx.restore();
  }

  private dpr(): number {
    return Math.min(2, window.devicePixelRatio || 1);
  }

  /** Where she stands on the screen, as stereo: -1 left … 1 right, softly
   * capped so the far edge never goes fully hard. 0 when the screen is unknown. */
  private pan(): number {
    const w = window.screen?.width ?? 0;
    if (!w) return 0;
    const x = window.screenX + window.innerWidth / 2;
    return Math.max(-0.6, Math.min(0.6, (x / w) * 2 - 1));
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  private local(e: MouseEvent): Point {
    return { x: e.clientX - this.offset.x, y: e.clientY - this.offset.y };
  }

  private wireInput() {
    document.addEventListener("pointerdown", (e) => {
      Sound.resume();
      if (e.button !== 0 || !isOverBody(this.local(e))) return;
      this.press = { client: this.local(e), screen: { x: e.screenX, y: e.screenY } };
      this.dragging = false;
      try {
        document.documentElement.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety */
      }
    });

    document.addEventListener("pointermove", (e) => {
      if (!this.dragging) this.notePointer(this.local(e));
      const press = this.press;
      if (!press) return;
      if (!this.dragging) {
        const l = this.local(e);
        if (Math.hypot(l.x - press.client.x, l.y - press.client.y) <= DRAG_THRESHOLD) return;
        this.beginDrag();
      }
      this.dragTo(e);
    });

    document.addEventListener("pointerup", (e) => {
      const press = this.press;
      this.press = null;
      if (!press) return;
      if (this.dragging) {
        this.endDrag(e);
        return;
      }
      // Single click → poke, once it is clear it isn't a double click.
      this.cancelPoke();
      this.pokeTimer = window.setTimeout(() => {
        this.pokeTimer = null;
        this.lastAgentActive = performance.now();
        this.wake();
        this.engine.slap();
        this.schedule();
      }, DOUBLE_CLICK_MS);
    });

    document.addEventListener("dblclick", (e) => {
      if (!isOverBody(this.local(e))) return;
      this.cancelPoke();
      void emitToWindow(ISLAND, DESKTOP_EVENTS.home);
    });

    document.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (isOverBody(this.local(e))) void emitToWindow(ISLAND, DESKTOP_EVENTS.wardrobe);
    });

    document.addEventListener("pointerleave", () => {
      if (this.mode !== "poll" && !this.dragging) this.cursor = null;
    });

    // A layer-shell drag stretches the window over the display; once it is
    // back to its own size, so is the canvas.
    window.addEventListener("resize", () => {
      if (!this.dragging && window.innerWidth <= PANEL_SIZE + 20) this.setOffset({ x: 0, y: 0 });
    });
  }

  private cancelPoke() {
    if (this.pokeTimer != null) window.clearTimeout(this.pokeTimer);
    this.pokeTimer = null;
  }

  private beginDrag() {
    this.dragging = true;
    this.cancelPoke();
    this.dragOrigin = null;
    this.dragTopLeft = null;
    void Bridge.desktopDragBegin().then((pos) => {
      if (!pos) {
        this.dragging = false;
        this.press = null;
        return;
      }
      this.dragOrigin = { x: pos[0], y: pos[1] };
    });
  }

  /** Linux: the page drives the drag. Windows: the cursor poll carries him. */
  private dragTo(e: PointerEvent) {
    const origin = this.dragOrigin;
    const press = this.press;
    if (!origin || !press || this.mode === "poll") return;
    this.trail();
    if (this.mode === "layer") {
      const applied = window.innerWidth > PANEL_SIZE + 20;
      const topLeft = layerDragTopLeft(origin, { x: e.clientX, y: e.clientY }, press.client, applied);
      this.dragTopLeft = topLeft;
      this.setOffset(applied ? topLeft : { x: topLeft.x - origin.x, y: topLeft.y - origin.y });
      return;
    }
    if (this.mode === "window") {
      const topLeft = windowDragTopLeft(origin, { x: e.screenX, y: e.screenY }, press.screen, this.dpr());
      this.dragTopLeft = topLeft;
      if (this.moveFrame) return;
      this.moveFrame = true;
      requestAnimationFrame(() => {
        this.moveFrame = false;
        const p = this.dragTopLeft;
        if (p && this.dragging) void Bridge.desktopDragMove(p.x, p.y);
      });
    }
  }

  private endDrag(e: PointerEvent) {
    this.dragTo(e);
    this.dragging = false;
    const topLeft = this.dragTopLeft;
    this.dragOrigin = null;
    this.dragTopLeft = null;
    // She lands: a small dust puff at her feet. Windows' poll-driven drag
    // lands elsewhere (the landing happy emote, below), so it puffs there.
    this.engine.puff();
    this.justDraggedUntil = performance.now() + 1500;
    this.schedule();
    if (this.mode === "poll" || !topLeft) return;
    void Bridge.desktopDragEnd(Math.round(topLeft.x), Math.round(topLeft.y));
  }

  /**
   * A faint spark trail while she slides across the desk, throttled so a fast
   * drag leaves a scatter rather than a solid line.
   */
  private trailAt = 0;
  private justDraggedUntil = 0;
  private trail() {
    const now = performance.now();
    if (now - this.trailAt <= 90) return;
    this.trailAt = now;
    this.engine.emit("spark", 1);
    this.schedule();
  }

  private setOffset(p: Point) {
    this.offset = p;
    this.canvas.style.left = `${p.x}px`;
    this.canvas.style.top = `${p.y}px`;
  }
}

const canvas = document.getElementById("mochi");
if (canvas instanceof HTMLCanvasElement) void new DesktopMochi(canvas).start();
