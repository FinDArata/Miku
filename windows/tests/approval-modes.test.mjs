// The approval modes resolver: which tool asks and which goes through, plus
// the map copy the card's Always button writes.

import { test } from "node:test";
import assert from "node:assert/strict";

const { modeFor, withMode } = await import("../src/core/approval-modes.ts");

test("a tool's own choice wins, then other tools, then ask", () => {
  const modes = { Bash: "always", Write: "ask", "*": "always" };
  assert.equal(modeFor(modes, "Bash"), "always");
  assert.equal(modeFor(modes, "Write"), "ask");
  // WebFetch has no row: the "other tools" choice speaks for it.
  assert.equal(modeFor(modes, "WebFetch"), "always");
  // Nothing set at all: ask, everywhere.
  assert.equal(modeFor(undefined, "Bash"), "ask");
  assert.equal(modeFor({}, "Bash"), "ask");
  // A value the app doesn't know reads as "no choice", not as an answer.
  assert.equal(modeFor({ Bash: "sometimes" }, "Bash"), "ask");
});

test("withMode copies, never mutates, and stays bounded", () => {
  const before = { Bash: "ask" };
  const after = withMode(before, "Bash", "always");
  assert.equal(after.Bash, "always");
  assert.equal(before.Bash, "ask"); // the card never rewrites history in place
  assert.equal(modeFor(withMode({}, "Grep", "always"), "Grep"), "always");
  // Past the bound, the oldest key makes way rather than the write failing.
  let modes = {};
  for (let i = 0; i < 64; i++) modes = withMode(modes, `tool_${i}`, "always");
  modes = withMode(modes, "one_more", "always");
  assert.equal(Object.keys(modes).length <= 64, true);
  assert.equal(modes.one_more, "always");
});
