// What each agent is doing right now, for the deck's Agents page
// (docs/mockups/widgets-agents.png): the step running and since when, the end
// of what the last tool printed, its task list (Claude Code's TodoWrite), and
// the last steps with their times. Kept in memory only, per agent pill; the
// hook handler (island/hooks.ts) feeds it.

export interface AgentTodo {
  content: string;
  /** "pending" | "in_progress" | "completed" */
  status: string;
}

export interface AgentStep {
  label: string;
  at: number;
}

export interface AgentLive {
  /** The step running now and when it started (Unix ms); null between steps. */
  running: AgentStep | null;
  /** The end of the last tool's output (a few lines). */
  output: string;
  todos: AgentTodo[];
  /** Newest last, at most HISTORY. */
  history: AgentStep[];
}

const HISTORY = 6;
const live = new Map<string, AgentLive>();

export function agentLive(id: string): AgentLive {
  let a = live.get(id);
  if (!a) {
    a = { running: null, output: "", todos: [], history: [] };
    live.set(id, a);
  }
  return a;
}

/** A tool starts (PreToolUse). */
export function stepStarted(id: string, label: string, now = Date.now()) {
  const a = agentLive(id);
  a.running = { label, at: now };
  a.history.push({ label, at: now });
  while (a.history.length > HISTORY) a.history.shift();
}

/** A tool finished (PostToolUse): its output's end, and nothing runs. */
export function stepFinished(id: string, outputTail: string | undefined) {
  const a = agentLive(id);
  a.running = null;
  if (outputTail) a.output = outputTail;
}

/** Claude Code's TodoWrite: the whole list each time. */
export function todosFrom(id: string, input: Record<string, unknown>) {
  const todos = input.todos;
  if (!Array.isArray(todos)) return;
  agentLive(id).todos = todos
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => ({
      content: String(x.content ?? x.activeForm ?? "").slice(0, 80),
      status: String(x.status ?? "pending"),
    }))
    .filter((x) => x.content);
}

/** A new prompt: the last turn's output and list no longer describe this one. */
export function turnStarted(id: string) {
  const a = agentLive(id);
  a.output = "";
  a.running = null;
}

/** "Bash · npm test" → ["Bash", "npm test"]. */
export function splitStep(label: string): [string, string] {
  const i = label.indexOf(" · ");
  return i < 0 ? [label, ""] : [label.slice(0, i), label.slice(i + 3)];
}

/** "0:42", "12:05". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
