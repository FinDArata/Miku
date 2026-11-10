// The working session, as pure rules: how long the agents have been at it
// without a pause, and which dictation milestones are worth a small
// celebration. No clock of its own, no storage — callers feed it and remember
// what has been celebrated.

/** Suggest a break after this long of continuous agent work. */
export const BREAK_AFTER_MS = 50 * 60 * 1000;
/** Agents idle this long and the streak is broken: the clock restarts. */
export const BREAK_RESET_MS = 5 * 60 * 1000;

/** Words in a day worth a nod; a streak of days worth one too. */
export const WORD_MILESTONES = [50, 100, 250, 500, 1000, 2500, 5000, 10000];
export const STREAK_MILESTONES = [3, 7, 14, 30, 100];

/**
 * Fed `active` edges (every half a minute is plenty) and says once per streak,
 * at the BREAK_AFTER_MS mark, that the work has gone on long enough to mention
 * a break. An idle gap of BREAK_RESET_MS resets it.
 */
export class BreakTracker {
  private activeSince: number | null = null;
  private lastActive = 0;
  private suggested = false;

  /** True once per streak, when the mark is crossed. */
  update(active: boolean, nowMs: number): boolean {
    if (active) {
      if (this.activeSince == null) this.activeSince = nowMs;
      this.lastActive = nowMs;
      if (!this.suggested && nowMs - this.activeSince >= BREAK_AFTER_MS) {
        this.suggested = true;
        return true;
      }
      return false;
    }
    if (this.lastActive !== 0 && nowMs - this.lastActive >= BREAK_RESET_MS) {
      this.activeSince = null;
      this.lastActive = 0;
      this.suggested = false;
    }
    return false;
  }
}

/** The smallest milestone `value` has reached that `already` has not. */
export function nextMilestone(list: readonly number[], already: number, value: number): number | null {
  let best: number | null = null;
  for (const m of list) {
    if (value >= m && already < m && (best == null || m < best)) best = m;
  }
  return best;
}
