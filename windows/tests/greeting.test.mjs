// The launch greeting (src/mochi/greeting.ts): Miku must never be cut off by
// the island while it grows, while she bounces and waves, or while it shrinks
// back to the compact island.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOOR, GREETING_END, GREETING_W, greetingPose, mochiBounds } from "../src/mochi/greeting.ts";
import { Tracked } from "../src/core/anim.ts";
import { COMPACT_W, NOTCH_H, NOTCH_W, VIEW_LAYOUTS } from "../src/core/layout.ts";

const FRAME = 1 / 60;
const SLACK = 0.5; // anti-aliasing

/** The figure's box against the island's, which is centred in the 640 px greeting canvas. */
function assertInside(t, tc, w, h) {
  const b = mochiBounds(greetingPose(t, tc));
  if (!b) return;
  const left = GREETING_W / 2 - w / 2;
  const right = GREETING_W / 2 + w / 2;
  const at = `t=${t.toFixed(3)} tc=${tc}`;
  // No check on the top: the island's own top edge is the screen's.
  assert.ok(b.bottom <= h + SLACK, `${at}: bottom ${b.bottom.toFixed(1)} below the island (${h.toFixed(1)})`);
  assert.ok(b.left >= left - SLACK, `${at}: left ${b.left.toFixed(1)} outside ${left.toFixed(1)}`);
  assert.ok(b.right <= right + SLACK, `${at}: right ${b.right.toFixed(1)} outside ${right.toFixed(1)}`);
}

/** Runs the island geometry the way Island does: spring open, then the 340 ms close curve. */
function run(tc) {
  const width = new Tracked(NOTCH_W);
  const height = new Tracked(0);
  width.springTo(GREETING_W);
  height.springTo(VIEW_LAYOUTS.greeting.height);
  let collapsed = false;
  const stop = Number.isFinite(tc) ? tc + 0.6 : GREETING_END + 0.5;
  for (let t = 0; t <= stop; t += FRAME) {
    const now = t * 1000;
    if (!collapsed && t >= tc) {
      collapsed = true;
      width.curveTowards(COMPACT_W, 340, now);
      height.curveTowards(NOTCH_H, 340, now);
    }
    width.step(FRAME, now);
    height.step(FRAME, now);
    assertInside(t, tc, width.value, height.value);
  }
}

test("Miku stays inside the island for the whole greeting", () => {
  run(Number.POSITIVE_INFINITY);
});

test("Miku stays inside the island when the greeting is cut short", () => {
  for (let tc = 0.3; tc < GREETING_END + 0.4; tc += 0.1) run(tc);
});

test("she rises through the stage floor, then waves in the middle", () => {
  const onLift = greetingPose(0.5);
  assert.ok(onLift.y > 120, `still on the lift at y=${onLift.y}`);
  assert.equal(onLift.floor, FLOOR, "the stage floor hides what is under it");
  const atWave = greetingPose(1.8);
  assert.equal(atWave.x, 320);
  // She waves with her hand, and her body sways along with it.
  assert.ok(atWave.wave >= 0, "waving");
  assert.notEqual(atWave.tilt, 0, "the tilt carries the wave");
  assert.ok(atWave.lyric > 0 && atWave.lyric < 1, "her name is being sung");
  const after = greetingPose(3.2);
  assert.equal(after.wave, -1);
  assert.equal(after.lyric, 1);
});

test("she lands where the compact island's Miku sits", () => {
  const end = greetingPose(10, 5);
  assert.equal(end.y, NOTCH_H / 2);
  assert.equal(end.x, GREETING_W / 2 - COMPACT_W / 2 + 40);
});
