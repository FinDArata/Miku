// The launch greeting (src/mochi/greeting.ts), a hologram: Miku must never be
// cut off by the island (invisible, but it still clips the greeting canvas)
// while it grows, while she is projected, or while she shrinks into the notch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPACT_LANDING, FOOT, GREETING_END, GREETING_W, faceAt, greetingPose, mochiBounds } from "../src/mochi/greeting.ts";
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
  for (let tc = 0.1; tc < GREETING_END + 0.4; tc += 0.1) run(tc);
});

test("no notch while she is projected: built feet first, then solid on the disc", () => {
  const building = greetingPose(1.1);
  assert.ok(building.build > 0 && building.build < 1, "being rendered");
  assert.equal(building.solid, 0, "still a teal hologram");
  assert.equal(building.notch, 0, "no notch yet");
  const held = greetingPose(2.4);
  assert.equal(held.build, 1);
  assert.equal(held.solid, 1);
  assert.equal(held.notch, 0);
  assert.equal(held.x, FOOT.x);
  assert.equal(held.y, FOOT.y);
});

test("she lands as the face in the compact island's notch", () => {
  const end = greetingPose(10, 5);
  const face = faceAt(COMPACT_LANDING);
  assert.equal(end.notch, 1);
  assert.equal(end.face, 1);
  assert.equal(end.x, face.x);
  assert.equal(end.y, face.y + face.r);
  assert.equal(face.x, GREETING_W / 2 - COMPACT_W / 2 + 40, "where the island draws her face");
  assert.equal(face.y, NOTCH_H / 2);
});

test("she lands wherever the island folds to: a closed strip, or no island at all", () => {
  const strip = { w: 90, h: 24, r: 10, face: { x: 14, y: 12, r: 9 }, fill: ["#000", "#000"] };
  const end = greetingPose(10, 5, strip);
  assert.equal(end.x, GREETING_W / 2 - 45 + 14);
  assert.equal(end.y, 12 + 9);
  const b = mochiBounds(end);
  assert.ok(b.bottom <= 24 && b.left >= GREETING_W / 2 - 45 && b.right <= GREETING_W / 2 + 45, "inside the strip");
  // No closed island: nothing to land as, she fades out on the way up.
  const none = { w: 0, h: 0, r: 0, face: null, fill: ["#000", "#000"] };
  assert.equal(greetingPose(10, 5, none).face, 1, "gone");
  assert.equal(mochiBounds(greetingPose(10, 5, none)), null, "nothing left drawn");
});

