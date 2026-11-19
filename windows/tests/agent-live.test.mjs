// What an agent is doing right now, for the deck's Agents page (src/core/agent-live.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { agentLive, elapsed, splitStep, stepFinished, stepStarted, todosFrom, turnStarted } from "../src/core/agent-live.ts";

test("a step runs from its start until the tool finishes, and keeps the output's end", () => {
  stepStarted("a1", "Bash · npm test", 1000);
  assert.deepEqual(agentLive("a1").running, { label: "Bash · npm test", at: 1000 });
  stepFinished("a1", "tests 632\npass 632");
  assert.equal(agentLive("a1").running, null);
  assert.equal(agentLive("a1").output, "tests 632\npass 632");
  // A tool with no output keeps the last one on screen.
  stepStarted("a1", "Read · deck.ts", 2000);
  stepFinished("a1", undefined);
  assert.equal(agentLive("a1").output, "tests 632\npass 632");
  // A new prompt clears it.
  turnStarted("a1");
  assert.equal(agentLive("a1").output, "");
});

test("the history keeps the last six steps", () => {
  for (let i = 0; i < 9; i++) stepStarted("a2", `Step ${i}`, i);
  const h = agentLive("a2").history;
  assert.equal(h.length, 6);
  assert.equal(h[0].label, "Step 3");
  assert.equal(h[5].label, "Step 8");
});

test("TodoWrite's list is read, junk left out", () => {
  todosFrom("a3", { todos: [
    { content: "Read the code", status: "completed" },
    { activeForm: "Running tests", status: "in_progress" },
    null,
    { content: "", status: "pending" },
  ] });
  assert.deepEqual(agentLive("a3").todos, [
    { content: "Read the code", status: "completed" },
    { content: "Running tests", status: "in_progress" },
  ]);
  todosFrom("a3", { nothing: true });
  assert.equal(agentLive("a3").todos.length, 2);
});

test("a step label splits into its tool and what it acts on; time reads m:ss", () => {
  assert.deepEqual(splitStep("Bash · npm test"), ["Bash", "npm test"]);
  assert.deepEqual(splitStep("Thinking"), ["Thinking", ""]);
  assert.equal(elapsed(42_000), "0:42");
  assert.equal(elapsed(725_000), "12:05");
  assert.equal(elapsed(-5), "0:00");
});

test("the deck opens on the agents while one works, waits, or finished moments ago", async () => {
  const { agentsActive } = await import("../src/views/deck.ts");
  const at = { a: 1_000_000 };
  const last = (id) => at[id];
  const now = 1_000_000 + 60_000;
  assert.equal(agentsActive([{ id: "a", isIntegration: false, state: "working" }], last, now), true);
  assert.equal(agentsActive([{ id: "a", isIntegration: false, state: "approval" }], last, now), true);
  assert.equal(agentsActive([{ id: "a", isIntegration: false, state: "finished" }], last, now), true);
  assert.equal(agentsActive([{ id: "a", isIntegration: false, state: "finished" }], last, now + 120_000), false);
  assert.equal(agentsActive([{ id: "a", isIntegration: false, state: "idle" }], last, now), false);
  assert.equal(agentsActive([{ id: "w", isIntegration: true, state: "working" }], last, now), false);
});

test("Miku holds a pose of her own on each page of the deck", async () => {
  const { deckPose, DECK_PAGES } = await import("../src/views/deck.ts");
  const calm = { pcLoad: "calm", playing: false, focus: "off", agentState: "idle", rainSoon: false, unread: false, shelved: false };
  const resting = ["pc", "music", "focus", "agents"].map((p) => deckPose(p, calm));
  assert.deepEqual(resting, ["working", "leek", "proud", "wink"]);
  assert.equal(new Set(resting).size, resting.length, "no two of them alike");
  assert.equal(deckPose("pc", { ...calm, pcLoad: "busy" }), "thinking");
  assert.equal(deckPose("pc", { ...calm, pcLoad: "strained" }), "dizzy");
  const { pcLoad } = await import("../src/views/deck.ts");
  assert.equal(pcLoad(null), "calm", "not read yet");
  assert.equal(pcLoad({ cpuPct: 23, ramPct: 48 }), "calm");
  assert.equal(pcLoad({ cpuPct: 72, ramPct: 50 }), "busy");
  assert.equal(pcLoad({ cpuPct: 20, ramPct: 81 }), "busy");
  assert.equal(pcLoad({ cpuPct: 94, ramPct: 50 }), "strained");
  assert.equal(pcLoad({ cpuPct: 10, ramPct: 92 }), "strained");
  assert.equal(deckPose("music", { ...calm, playing: true }), "singing");
  assert.equal(deckPose("focus", { ...calm, focus: "run" }), "thinking");
  assert.equal(deckPose("focus", { ...calm, focus: "break" }), "yawn");
  assert.equal(deckPose("agents", { ...calm, agentState: "working" }), "working", "a busy agent shows what it does");
  for (const p of DECK_PAGES) assert.ok(deckPose(p, calm), p);
});
