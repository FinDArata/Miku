// When Miku's catch happens, with copies still running (src/views/catch.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { catchTimeline } from "../src/views/catch.ts";

test("quick copies fly as soon as she is ready, with no copy bar", () => {
  const tl = catchTimeline([{ copied: 0.05 }, { copied: 0.1 }]);
  assert.equal(tl.bar, false);
  assert.equal(tl.pending, false);
  assert.equal(tl.flyAt[0], tl.ready);
  assert.ok(tl.flyAt[1] > tl.flyAt[0], "one after the other");
  assert.ok(Number.isFinite(tl.done));
});

test("a copy still running holds its file, and the catch has no end yet", () => {
  const tl = catchTimeline([{ copied: 0.1 }, { copied: null }]);
  assert.equal(tl.pending, true);
  assert.equal(tl.bar, true);
  assert.equal(tl.flyAt[1], Infinity);
  assert.equal(tl.done, Infinity);
});

test("a slow file flies when its copy is done, and the bar gets its 100 % moment", () => {
  const tl = catchTimeline([{ copied: 0.2 }, { copied: 4 }]);
  assert.equal(tl.flyAt[1], 4);
  assert.equal(tl.allAt, 4);
  assert.ok(tl.done > 4 + 0.9, "the Done! moment plays out before the catch ends");
});

test("a failed copy never flies and does not hold the catch open", () => {
  const tl = catchTimeline([{ copied: 0.3 }, { copied: 0.4, failed: true }]);
  assert.equal(tl.flyAt[1], Infinity);
  assert.ok(Number.isFinite(tl.done));
});
