// The stage's life (src/hub/stage-life.ts): what Miku says, what she does when
// nothing is happening, what a change of state makes her do, and the weather
// each Miku brings. Pure functions — no DOM, no canvas.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  AWAKE_ANTICS, AWAKE_MS, BUBBLES, BUBBLE_EVERY_MS, CLICK_BUBBLE, DOZE_MS, DOUBLE_CLICK_BUBBLE,
  MUSIC_BUBBLE, STAGE_STATES, awakeAntic, burstFor, firstBubble, nextAwake, nextBubble, nextBubbleAt,
  nextDoze, weatherFor,
} = await import("../src/hub/stage-life.ts");

/** A random that always returns `v`. */
const fixed = (v) => () => v;

test("every stage state has lines, and the first is the one a new stage wears", () => {
  assert.deepEqual([...STAGE_STATES].sort(), ["clear", "idle", "running", "waiting-permission"]);
  for (const state of STAGE_STATES) {
    assert.ok(BUBBLES[state].length > 0, `${state} has no lines`);
    assert.equal(new Set(BUBBLES[state]).size, BUBBLES[state].length, `${state} repeats a line`);
    assert.equal(firstBubble(state), BUBBLES[state][0]);
  }
});

test("the next line is never the one already showing", () => {
  for (const state of STAGE_STATES) {
    const [first, ...rest] = BUBBLES[state];
    if (rest.length === 0) {
      assert.equal(nextBubble(state, first, fixed(0.5)), first);
      continue;
    }
    for (const v of [0, 0.25, 0.5, 0.99]) {
      for (const current of BUBBLES[state]) {
        if (BUBBLES[state].length === 1) break;
        assert.notEqual(nextBubble(state, current, fixed(v)), current);
      }
    }
  }
});

test("the next line stays inside its state's set", () => {
  for (const state of STAGE_STATES) {
    for (const current of BUBBLES[state]) {
      for (const v of [0, 0.33, 0.66, 1]) {
        assert.ok(BUBBLES[state].includes(nextBubble(state, current, fixed(v))));
      }
    }
  }
});

test("the click lines are their own, not a state's", () => {
  const all = STAGE_STATES.flatMap((s) => [...BUBBLES[s]]);
  assert.ok(!all.includes(CLICK_BUBBLE));
  assert.ok(!all.includes(DOUBLE_CLICK_BUBBLE));
  assert.ok(!all.includes(MUSIC_BUBBLE));
});

test("the delays are inside their bounds, at both ends of the random", () => {
  const cases = [
    [nextDoze, DOZE_MS],
    [nextAwake, AWAKE_MS],
    [nextBubbleAt, BUBBLE_EVERY_MS],
  ];
  for (const [fn, [lo, hi]] of cases) {
    assert.equal(fn(fixed(0)), lo);
    assert.equal(fn(fixed(1)), hi);
    assert.equal(fn(fixed(0.5)), Math.round(lo + (hi - lo) * 0.5));
    // Out of range randoms are clamped, not trusted.
    assert.equal(fn(fixed(-1)), lo);
    assert.equal(fn(fixed(2)), hi);
  }
});

test("waking comes sooner than dozing off again", () => {
  assert.ok(AWAKE_MS[1] < DOZE_MS[0], "she would never be seen asleep");
});

test("an awake antic is always one of the four, and the yawn is the rare one", () => {
  const seen = new Map();
  for (let i = 0; i < 1000; i++) {
    const antic = awakeAntic(fixed(i / 1000));
    assert.ok(AWAKE_ANTICS.includes(antic), `${antic} is not an antic`);
    seen.set(antic, (seen.get(antic) ?? 0) + 1);
  }
  assert.equal(seen.size, AWAKE_ANTICS.length, "one of them never happens");
  // The yawn ends the spell, so it must be the least frequent of the four.
  assert.ok(seen.get("yawn") <= Math.min(seen.get("wink"), seen.get("proud"), seen.get("happy")));
});

test("a state that does not change reacts to nothing", () => {
  for (const state of STAGE_STATES) assert.equal(burstFor(state, state), null);
});

test("each turn has its own burst, and the praise is the loudest", () => {
  const b = {};
  for (const from of STAGE_STATES) {
    for (const to of STAGE_STATES) {
      if (from !== to) b[`${from}->${to}`] = burstFor(from, to);
    }
  }
  for (const [key, burst] of Object.entries(b)) {
    assert.ok(burst, `${key} has no burst`);
    if (burst.emote === null && burst.particle === null) {
      assert.fail(`${key} is silent`);
    }
  }
  // "clear" is the one with stars, and the most of them.
  const clear = burstFor("running", "clear");
  assert.equal(clear.particle, "star");
  const counts = Object.values(b).map((x) => x.count);
  assert.equal(clear.count, Math.max(...counts));
  // Waiting for a permission is a startle, not a celebration.
  const wait = burstFor("idle", "waiting-permission");
  assert.equal(wait.emote, "surprised");
  assert.equal(wait.particle, "sweat");
});

test("the weather follows the Miku on stage", () => {
  assert.equal(weatherFor("snow"), "snow");
  assert.equal(weatherFor("sakura"), "petal");
  assert.equal(weatherFor("classic"), "sparkle");
  // Anything the wardrobe hands over is one of the three.
  for (const id of ["classic", "snow", "sakura"]) {
    assert.ok(["snow", "petal", "sparkle"].includes(weatherFor(id)));
  }
});
