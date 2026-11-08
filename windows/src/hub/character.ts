// The Mochi Stage: the character slot of the Miku window's pages, ported from
// the "Mochi Stage" concept (concept-jj-hero2.html, concept-jj-states.html).
// A dashed ring spins around a glow disc, the character stands in the middle
// with a speech bubble, and both follow the state the window believes the
// agents are in. The stage is one reusable element: the band's hero takes it
// full size, a compact band takes a smaller corner one.

import { h } from "../views/dom";
import { t } from "../i18n/i18n";
import { Bridge } from "../core/bridge";

/** What the character is up to (the mockup's four character states). */
export type StageState = "waiting-permission" | "running" | "clear" | "idle";

/** hero: the full stage at the right of a band; peek: a smaller corner one. */
export type StageSize = "hero" | "peek";

export const STAGE_STATES: StageState[] = ["waiting-permission", "running", "clear", "idle"];

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

/** The line in the character's speech bubble, per state. */
function stateBubble(state: StageState): string {
  switch (state) {
    case "waiting-permission": return t("Permission first, please!");
    case "running": return t("Focus mode…");
    case "clear": return t("All done — time to dance!");
    default: return t("Zzz… call me when you need me");
  }
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
 */
export function setStageState(state: StageState) {
  if (state === current) return;
  current = state;
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
    const bubble = stage.querySelector(".mochi-bubble");
    if (bubble) bubble.textContent = stateBubble(current);
  }
  for (const row of document.querySelectorAll(".hub-states")) {
    const chips = row.querySelectorAll(".hub-state-chip");
    STAGE_STATES.forEach((state, i) => chips[i]?.classList.toggle("on", state === current));
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

// ── The pieces ────────────────────────────────────────────────────────────────

/**
 * The character itself, in a slot of its own so the asset can change in one
 * place; the stage around it (ring, disc, sparkles, bubble) never moves.
 * TODO: replace with real character asset (PNG/WebM/Lottie).
 */
export function renderCharacter(): HTMLElement {
  return h("span", { class: "mochi-char-asset", text: "🐱", "aria-hidden": "true" });
}

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

/** The stage: sparkles, spinning ring, glow disc, character, speech bubble. */
export function characterStage(opts: StageOptions = {}): HTMLElement {
  const state = opts.state ?? currentStageState();
  const size = opts.size ?? "hero";
  const bubble = opts.silent || size === "peek"
    ? null
    : h("div", { class: "mochi-bubble", text: opts.bubble ?? stateBubble(state) });
  return h("div", {
    class: `mochi-stage ${size === "peek" ? "peek" : ""} st-${state}`,
    "aria-hidden": "true",
  },
    h("span", { class: "mochi-sparkle s1", text: "✦" }),
    h("span", { class: "mochi-sparkle s2", text: "✧" }),
    h("span", { class: "mochi-sparkle s3", text: "✦" }),
    h("span", { class: "mochi-sparkle s4", text: "✧" }),
    h("div", { class: "mochi-ring" }),
    h("div", { class: "mochi-disc" }),
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
