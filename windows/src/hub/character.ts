// The Mochi Stage: the character slot of the Miku window's pages, ported from
// the "Mochi Stage" concept (concept-jj-hero2.html, concept-jj-states.html).
// A dashed ring spins around a glow disc, the character stands in the middle
// with a speech bubble, and both follow the state the window believes the
// agents are in. The stage is one reusable element: the band's hero takes it
// full size, a compact band takes a smaller corner one.
//
// What she says and does is decided in hub/stage-life.ts; this file wires those
// answers to the DOM and the engine — a doze-and-stir cycle while the agents are
// idle, a new line in the bubble now and then, a burst when the state turns, a
// dance while music plays, and a click that reaches her.

import { h } from "../views/dom";
import { t } from "../i18n/i18n";
import { Bridge, onEvent } from "../core/bridge";
import { State } from "../core/state";
import { musicPlaying, type SpotifyState } from "../core/spotify";
import { sanitizeDeclared } from "../core/pills";
import type { BotStateName } from "../core/layout";
import type { BotEngine } from "../mochi/engine";
import { liveMochi, stageWeather } from "./hero";
import {
  BUBBLES, CLICK_BUBBLE, DOUBLE_CLICK_BUBBLE, MUSIC_BUBBLE, STAGE_STATES,
  awakeAntic, burstFor, firstBubble, nextAwake, nextBubble, nextBubbleAt, nextDoze,
  type Burst, type StageState,
} from "./stage-life";

/** What the character is up to (the mockup's four character states). */
export type { StageState };
export { STAGE_STATES };

/** hero: the full stage at the right of a band; peek: a smaller corner one. */
export type StageSize = "hero" | "peek";

/** The colour each state wears, on its chip's dot, ring and glow. */
const STATE_COLORS: Record<StageState, string> = {
  "waiting-permission": "#ffb84d",
  running: "#39c5bb",
  clear: "#4ade80",
  idle: "#8a94a2",
};

function stateLabel(state: StageState): string {
  switch (state) {
    case "waiting-permission": return t("Waiting for permission");
    case "running": return t("Agent running");
    case "clear": return t("Session clear");
    default: return t("Idle");
  }
}

/** The line she wears when the state turns (the first line of its set). */
function stateBubble(state: StageState): string {
  return t(firstBubble(state));
}

// ── The state the stage shows ─────────────────────────────────────────────────

/**
 * The stage's state, as far as this window can know. The hook events that tell
 * the island what the agents are doing are sent to the island's window only,
 * so this one is told by the backend instead: the "hub-stage" event when the
 * state changes, and the "hub_stage_state" command its poll asks. Until the
 * first answer, the stage wears "idle" — the mockup's calm mode.
 */
let current: StageState = "idle";

export function currentStageState(): StageState {
  return current;
}

/**
 * A live source drives the stage from here. The state itself is kept at once
 * (a page built now has to wear it), while what is already on the page is
 * repainted on a short timer: two states arriving in a burst — a turn ending
 * and the next starting, a request answered — must not flicker between them.
 * Her reaction to the turn is not delayed with the repaint: it happens now.
 */
export function setStageState(state: StageState) {
  if (state === current) return;
  const burst = burstFor(current, state);
  current = state;
  if (burst) for (const one of engines) runBurst(one, burst);
  if (refreshTimer === null) {
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      paintStage();
    }, REFRESH_DELAY);
  }
}

/** The burst the repaint above waits out, and its pending timer. */
const REFRESH_DELAY = 300;
let refreshTimer: number | null = null;

/** Swaps the state on every stage and chips row on the page, in place. */
function paintStage() {
  for (const stage of document.querySelectorAll<HTMLElement>(".mochi-stage")) {
    for (const state of STAGE_STATES) stage.classList.toggle(`st-${state}`, state === current);
  }
  for (const row of document.querySelectorAll(".hub-states")) {
    const chips = row.querySelectorAll(".hub-state-chip");
    STAGE_STATES.forEach((state, i) => chips[i]?.classList.toggle("on", state === current));
  }
  // The Mikus change their pose with the state, and the ones whose pages have
  // gone are forgotten. Their bubbles are theirs to write (see `setBubble`):
  // the loop over the DOM above must not touch a line she is saying.
  for (const one of engines) {
    if (!one.canvas.isConnected) {
      engines.delete(one);
      continue;
    }
    // A new state starts a new spell: awake, and talking about it. She only
    // dozes on "idle" — a turn under way or a permission waiting is no time to
    // sleep. A click's line still gets its moment, so `held` is left alone.
    one.holding = dancing;
    wake(one, performance.now());
    setBubble(one, firstBubble(current));
  }
}

/** The backend's answer, once it says a state we know. */
function isStageState(state: string): state is StageState {
  return STAGE_STATES.includes(state as StageState);
}

/** Asks the backend for its snapshot now and wears it (the poll, and the show). */
export async function syncStageState() {
  const state = await Bridge.hubStageState();
  if (state && isStageState(state)) setStageState(state);
}

/**
 * While the window is on screen, the stage is also polled: the backend
 * announces every change ("hub-stage"), but a window created hidden or
 * restored mid-turn may have missed the announcement, so a slow poll stands
 * in. Guarded against duplicate intervals; cleared as soon as it is hidden.
 */
const STAGE_POLL_MS = 4000;
let poll: number | null = null;

export function setStagePolling(shown: boolean) {
  if (!shown) {
    if (poll !== null) {
      window.clearInterval(poll);
      poll = null;
    }
    return;
  }
  if (poll !== null) return;
  void syncStageState();
  poll = window.setInterval(() => void syncStageState(), STAGE_POLL_MS);
}

// ── Music ─────────────────────────────────────────────────────────────────────

/** Music is playing on a declared pill: the compact island's rule. */
let dancing = false;

/** The stage's Miku dances while this is true (`liveMochi` asks every frame). */
export function stageDances(): boolean {
  return dancing;
}

const DECLARED = () => sanitizeDeclared(State.settings, State.os).activeIntegrations;

/** The player's report (Rust → "spotify"), read against the declared pills. */
function applyMusic(state: SpotifyState | null) {
  if (!state) return;
  const on = musicPlaying(state, DECLARED());
  if (on === dancing) return;
  dancing = on;
  // The CSS sway rides on the stage itself, beside the engine's own dance.
  for (const stage of document.querySelectorAll<HTMLElement>(".mochi-stage")) {
    stage.classList.toggle("dancing", on);
  }
  for (const one of engines) {
    if (!one.canvas.isConnected) continue;
    one.holding = on;
    setBubble(one, on ? MUSIC_BUBBLE : BUBBLES[current][0]);
    if (on) one.engine.triggerEmote("happy", 1.4);
  }
}

/**
 * The player's own event, as the island takes it, plus one snapshot at the
 * start: a stage built during a song must dance at once rather than wait for
 * the next track. Never unsubscribed — the listener lives with the window.
 */
let musicWired = false;

export function watchMusic() {
  if (musicWired) return;
  musicWired = true;
  let heard = false;
  void onEvent<SpotifyState>("spotify", (state) => {
    heard = true;
    applyMusic(state);
  });
  void Bridge.spotifyRefresh().then((state) => {
    if (!heard) applyMusic(state);
  });
}

// ── The pieces ────────────────────────────────────────────────────────────────

/** One live stage Miku: her engine, the canvas she is drawn into, and her mood. */
interface StageMochi {
  canvas: HTMLCanvasElement;
  engine: BotEngine;
  /** Dozing, or up and about. Only "idle" lets her sleep. */
  asleep: boolean;
  /** When the current phase (asleep or awake) ends. */
  phaseEnd: number;
  nextBubbleAt: number;
  /** The English key of the line the bubble shows, for `nextBubble`. */
  line: string;
  /** A click owns the bubble for a moment: the life timer leaves its words. */
  held: boolean;
  /** The bubble belongs to something else (music, a click): leave its words. */
  holding: boolean;
}

/** Every Miku on the page. Pruned of removed canvases at each repaint. */
const engines = new Set<StageMochi>();

/**
 * The character itself, in a slot of its own so the asset can change in one
 * place; the stage around it (ring, disc, sparkles, bubble) never moves.
 * This is the real Miku, drawn by the island's own BotEngine (the same live
 * canvas the sidebar brand and the wardrobe previews use): she follows the
 * pointer with her eyes, reacts to a click, and wears the outfit and variant
 * picked in the wardrobe. A future static/WebM/Lottie asset replaces this
 * canvas here and nowhere else.
 */
function renderCharacter(): HTMLElement {
  const canvas = h("canvas", { class: "mochi-char-canvas", "aria-hidden": "true" }) as HTMLCanvasElement;
  const engine = liveMochi(canvas, "#F5F6F8", botState(currentStageState()), 0.16, {
    dancing: stageDances,
  });
  const one: StageMochi = {
    canvas,
    engine,
    asleep: current === "idle",
    phaseEnd: performance.now() + (current === "idle" ? nextDoze(Math.random) : nextAwake(Math.random)),
    nextBubbleAt: performance.now() + nextBubbleAt(Math.random),
    line: firstBubble(current),
    held: false,
    holding: false,
  };
  engine.onDizzy = () => engine.triggerEmote("annoyed", 1.6);
  engines.add(one);
  wirePointer(one);
  startLife();
  return canvas;
}

/** The stage's four states, worn by the engine as its own bot states. */
function botState(state: StageState): BotStateName {
  switch (state) {
    case "waiting-permission": return "approval";
    case "running": return "working";
    case "clear": return "finished";
    default: return "sleeping";
  }
}

/** Her bubble, if the stage still has one (a peek stage has no room). */
function bubbleOf(one: StageMochi): HTMLElement | null {
  return one.canvas.parentElement?.querySelector(".mochi-bubble") ?? null;
}

/**
 * Writes a line and replays the pop, so a new line is noticed. A bubble that
 * already says it is left alone: the pop must mark change, not every call.
 */
function setBubble(one: StageMochi, line: string) {
  const bubble = bubbleOf(one);
  if (!bubble || one.holding || one.held) return;
  one.line = line;
  const text = t(line);
  if (bubble.textContent === text) return;
  bubble.textContent = text;
  pop(bubble);
}

/** Removes and re-adds `pop` with a style flush between, to restart the keyframes. */
function pop(bubble: HTMLElement) {
  bubble.classList.remove("pop");
  void bubble.offsetWidth;
  bubble.classList.add("pop");
}

/** One off reaction: an emote and its particles. */
function runBurst(one: StageMochi, burst: Burst) {
  if (burst.emote) one.engine.triggerEmote(burst.emote, 1.6);
  if (burst.particle && burst.count > 0) one.engine.emit(burst.particle, burst.count);
}

// ── Her mood ──────────────────────────────────────────────────────────────────

/**
 * Wakes her up for a spell: the state's own pose back, and a timer to the next
 * step. On "idle" that step is falling asleep again; on the others it is one
 * more small antic, since there is no sleeping while work is under way.
 */
function wake(one: StageMochi, at: number) {
  one.asleep = false;
  one.engine.setState(botState(current), true);
  one.phaseEnd = at + nextAwake(Math.random);
}

/** Sends her to sleep: only ever on "idle", and only from `stageLifeStep`. */
function doze(one: StageMochi, at: number) {
  one.asleep = true;
  one.engine.setState("sleeping", true);
  one.phaseEnd = at + nextDoze(Math.random);
}

/**
 * One step of her life. A single timer drives every stage on the page; each
 * one only compares two numbers when nothing is due, so a page with three
 * bands costs three comparisons a step.
 *
 * The cycle, while the agents are idle: she sleeps for half a minute or so,
 * stirs (a wink, a proud little nod, a yawn), stays up for ten seconds, and
 * dozes off again. While an agent is running or a permission waits she stays
 * up — the pose is the state's — and only the lines change.
 */
export function stageLifeStep(at = performance.now()) {
  for (const one of engines) {
    if (!one.canvas.isConnected) {
      engines.delete(one);
      continue;
    }
    if (at >= one.phaseEnd) {
      if (one.asleep) {
        // Waking up: a small antic, then a spell of being up.
        wake(one, at);
        const antic = awakeAntic(Math.random);
        if (!one.holding) one.engine.triggerEmote(antic, antic === "yawn" ? 1.6 : 1.4);
        one.engine.emit(antic === "proud" ? "star" : "spark", antic === "proud" ? 3 : 1);
      } else if (current === "idle") {
        doze(one, at);
      } else {
        // No sleeping while there is work: stay up, and do one small thing.
        one.phaseEnd = at + nextAwake(Math.random);
        if (!one.holding) one.engine.triggerEmote(awakeAntic(Math.random), 1.4);
      }
    }
    if (at >= one.nextBubbleAt) {
      one.nextBubbleAt = at + nextBubbleAt(Math.random);
      // `one.line` is the key in the current language, not the drawn text:
      // comparing the translated text with an English key would always differ
      // and the same line could come up twice.
      if (!one.holding) setBubble(one, nextBubble(current, one.line, Math.random));
    }
  }
}

/** The one timer every stage shares, started with the first one. */
let lifeTimer: number | null = null;

function startLife() {
  if (lifeTimer !== null) return;
  lifeTimer = window.setInterval(() => stageLifeStep(), 800);
  (lifeTimer as unknown as { unref?: () => void }).unref?.();
}

/**
 * Every Miku on the page waves: she greets the page that just arrived. Called
 * by the shell when the user moves between pages — the stage is rebuilt each
 * time, so the new one starts the wave itself; this reaches the ones that
 * are still on screen (the sidebar's brand, a band that was already drawn).
 */
export function characterGreet() {
  for (const one of engines) {
    if (!one.canvas.isConnected) continue;
    one.engine.greet();
    one.holding = false;
  }
}

// ── The pointer ───────────────────────────────────────────────────────────────

/**
 * A click reaches her — the stage is `pointer-events: none` so it never steals
 * a click from the band, and the canvas opts back in — a second click within
 * a third of a second is a thank-you, and a hover is a small hello. The slap
 * itself is the engine's own (`liveMochi` listens too); this only speaks.
 */
function wirePointer(one: StageMochi) {
  const canvas = one.canvas;
  let lastClick = 0;
  canvas.addEventListener("pointerenter", () => one.engine.triggerEmote("happy", 1.2));
  canvas.addEventListener("click", (e) => {
    const at = performance.now();
    const twice = at - lastClick < 320;
    lastClick = at;
    if (twice) {
      one.engine.triggerEmote("love", 1.6);
      one.engine.emit("heart", 4);
      say(one, DOUBLE_CLICK_BUBBLE, 2200);
    } else {
      say(one, CLICK_BUBBLE, 1600);
    }
    // The click is hers: it must not also reach whatever is behind the stage.
    e.stopPropagation?.();
  });
}

/** A line that outlives its welcome: whatever owns the bubble comes back after. */
function say(one: StageMochi, line: string, ms: number) {
  const bubble = bubbleOf(one);
  if (!bubble) return;
  one.held = true;
  bubble.textContent = t(line);
  pop(bubble);
  window.setTimeout(() => {
    // Another click, a dance starting, or a new state may have taken it over:
    // putting the old words back would undo that.
    if (bubble.textContent !== t(line)) return;
    one.held = false;
    // Asked now, not when the line went up: music may have started since.
    one.line = one.holding ? MUSIC_BUBBLE : firstBubble(current);
    bubble.textContent = t(one.line);
  }, ms);
}

// ── The stage ─────────────────────────────────────────────────────────────────

export interface StageOptions {
  /** The state to show; the window's current one when left out. */
  state?: StageState;
  /** "hero" (default) or "peek", the compact band's corner stage. */
  size?: StageSize;
  /** A line for the speech bubble; the state's own line when left out. */
  bubble?: string | null;
  /** No bubble at all ("peek" hides it anyway, there is no room). */
  silent?: boolean;
}

/** The stage: sparkles, orbiting motes, two rings, glow disc, weather, character. */
export function characterStage(opts: StageOptions = {}): HTMLElement {
  const state = opts.state ?? currentStageState();
  const size = opts.size ?? "hero";
  const bubble = opts.silent || size === "peek"
    ? null
    : h("div", { class: "mochi-bubble pop", text: opts.bubble ?? stateBubble(state) });
  const weather = h("canvas", { class: "mochi-weather", "aria-hidden": "true" }) as HTMLCanvasElement;
  stageWeather(weather);
  return h("div", {
    class: `mochi-stage ${size === "peek" ? "peek" : ""} ${dancing ? "dancing" : ""} st-${state}`,
    "aria-hidden": "true",
  },
    h("span", { class: "mochi-sparkle s1", text: "✦" }),
    h("span", { class: "mochi-sparkle s2", text: "✧" }),
    h("span", { class: "mochi-sparkle s3", text: "✦" }),
    h("span", { class: "mochi-sparkle s4", text: "✧" }),
    h("span", { class: "mochi-orbit o1" }),
    h("span", { class: "mochi-orbit o2" }),
    h("div", { class: "mochi-ring" }),
    h("div", { class: "mochi-ring inner" }),
    h("div", { class: "mochi-disc" }),
    weather,
    h("div", { class: "mochi-shadow" }),
    h("div", { class: "mochi-char" },
      renderCharacter(),
      bubble,
    ),
  );
}

/** The row under the band: "CHARACTER STATE" and one chip per state. */
export function stateChips(active: StageState = currentStageState()): HTMLElement {
  const row = h("div", { class: "hub-states", role: "group" },
    h("span", { class: "hub-states-label", text: t("Character state") }),
  );
  for (const state of STAGE_STATES) {
    row.append(h("span", {
      class: state === active ? "hub-state-chip on" : "hub-state-chip",
      title: stateLabel(state),
    },
      h("i", { class: "d", style: `background:${STATE_COLORS[state]}` }),
      h("span", { text: stateLabel(state) }),
    ));
  }
  return row;
}
