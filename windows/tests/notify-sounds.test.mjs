// The sound a notice plays (src/core/sound.ts notifySound): the user's pick per slot.

import { test } from "node:test";
import assert from "node:assert/strict";
import { notifySound } from "../src/core/sound.ts";

const has = (name) => name === "line";

test("nothing picked plays the usual sound", () => {
  assert.equal(notifySound(undefined, "line", "pop", has), "pop");
  assert.equal(notifySound("", "agent", "finish", has), "finish");
});

test("none is silent, a built-in plays as itself, an unknown name falls back", () => {
  assert.equal(notifySound("none", "line", "pop", has), "");
  assert.equal(notifySound("love", "line", "pop", has), "love");
  assert.equal(notifySound("nope", "line", "pop", has), "pop");
});

test("the user's file plays when it loaded, else the usual sound", () => {
  assert.equal(notifySound("file", "line", "pop", has), "line");
  assert.equal(notifySound("file", "discord", "pop", has), "pop");
});

test("an agent's finish names the agent, Claude Code when there is none", async () => {
  const { agentVoice } = await import("../src/core/sound.ts");
  assert.equal(agentVoice(null), "app-claude");
  assert.equal(agentVoice("codex"), "app-codex");
  assert.equal(agentVoice("hermes"), "app-agent");
});

test("the launch hello is こんばんは in the evening, one of the three by day", async () => {
  const { greetingSound } = await import("../src/mochi/greeting.ts");
  assert.equal(greetingSound(19), "greeting-konbanwa");
  assert.equal(greetingSound(2), "greeting-konbanwa");
  assert.equal(greetingSound(9, 0), "greeting-matteta");
  assert.equal(greetingSound(9, 0.99), "greeting-ganbarou");
});
