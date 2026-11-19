// The per-tool approval choices (Settings → Agents → Approvals, and the card's
// Always button): how a tool's permission requests are handled — the card comes
// up ("ask") or they are let through without asking ("always"). A tool the map
// says nothing about falls to "*", the "other tools" row; nothing set at all
// asks, everywhere.

export type ApprovalMode = "ask" | "always";

export type ApprovalModes = Record<string, ApprovalMode>;

/** How requests from `tool` are handled: its own choice, else "other tools",
 * else ask. */
export function modeFor(modes: ApprovalModes | undefined, tool: string): ApprovalMode {
  if (!modes) return "ask";
  const own = modes[tool];
  if (own === "always" || own === "ask") return own;
  return modes["*"] === "always" ? "always" : "ask";
}

/** A copy of `modes` with `tool` set to `mode` — the card's Always button.
 * The map is bounded: past 64 tools the oldest-reading user has bigger
 * problems, and the hub can prune. */
export function withMode(modes: ApprovalModes, tool: string, mode: ApprovalMode): ApprovalModes {
  const next = { ...modes };
  const keys = Object.keys(next);
  if (!(tool in next) && keys.length >= 64) delete next[keys[0]];
  next[tool] = mode;
  return next;
}
