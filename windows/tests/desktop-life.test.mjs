// Mochi's life on the desktop, apart from what the island reports: the hour's
// mood, the small antics he does when nothing needs him, and what a battery
// reading makes him do. All pure, so the table here is the whole behaviour.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  timeMood, idleAntic, nextAnticDelay, freeForAntics, batteryReaction,
  IDLE_ANTICS, IDLE_ANTIC_AFTER_MS, IDLE_ANTIC_EVERY_MS,
} = await import("../src/mochi/desktop-logic.ts");

// ── The hour ─────────────────────────────────────────────────────────────────

test("mornings he is glad, late nights he sleeps, and the after-lunch dip yawns", () => {
  // 5:00 up to (not including) 12:00.
  for (const h of [5, 6, 8, 11]) assert.equal(timeMood(h), "happy", String(h));
  // 22:00 up to 5:00, across midnight.
  for (const h of [22, 23, 0, 3, 4]) assert.equal(timeMood(h), "sleeping", String(h));
  // Lunch, and a moment after it.
  assert.equal(timeMood(12), "yawn");
  assert.equal(timeMood(13), "yawn");
  // The afternoon and the evening are ordinary: no mood at all.
  for (const h of [14, 17, 20, 21]) assert.equal(timeMood(h), null, String(h));
});

test("an hour outside the clock is read as the nearest real hour", () => {
  // Midnight the next day, and an hour before the epoch of a day.
  assert.equal(timeMood(24), "sleeping");
  assert.equal(timeMood(-1), "sleeping");
  // 30 → 6 in the morning; -19 → 5.
  assert.equal(timeMood(30), "happy");
  assert.equal(timeMood(-19), "happy");
  // Nothing at all is no mood, not a wrong one.
  assert.equal(timeMood(Number.NaN), null);
  assert.equal(timeMood(Infinity), null);
});

// ── Antics ──────────────────────────────────────────────────────────────────

test("the antics are the four he has, and a glance is the ordinary one", () => {
  assert.deepEqual([...IDLE_ANTICS], ["lookDrift", "wink", "proud", "yawn"]);
  assert.equal(IDLE_ANTIC_AFTER_MS, 90_000);
  assert.deepEqual([...IDLE_ANTIC_EVERY_MS], [20_000, 45_000]);
});

test("an antic is picked by an injected draw, weighted towards looking around", () => {
  assert.equal(idleAntic(() => 0), "lookDrift");
  assert.equal(idleAntic(() => 0.44), "lookDrift");
  assert.equal(idleAntic(() => 0.45), "wink");
  assert.equal(idleAntic(() => 0.69), "wink");
  assert.equal(idleAntic(() => 0.7), "proud");
  assert.equal(idleAntic(() => 0.89), "proud");
  assert.equal(idleAntic(() => 0.9), "yawn");
  assert.equal(idleAntic(() => 1), "yawn");
});

test("the next antic waits between twenty and forty-five seconds", () => {
  assert.equal(nextAnticDelay(() => 0), 20_000);
  assert.equal(nextAnticDelay(() => 1), 45_000);
  assert.equal(nextAnticDelay(() => 0.5), 32_500);
  // A generator that goes out of range is clamped, never a negative wait.
  assert.equal(nextAnticDelay(() => -3), 20_000);
  assert.equal(nextAnticDelay(() => 9), 45_000);
});

test("he is only silly when nothing needs him", () => {
  const free = { visible: true, asleep: false, dancing: false, paused: false, dragging: false };
  assert.equal(freeForAntics(free), true);
  // Every single reason not to, one at a time.
  assert.equal(freeForAntics({ ...free, visible: false }), false);
  assert.equal(freeForAntics({ ...free, asleep: true }), false);
  assert.equal(freeForAntics({ ...free, dancing: true }), false);
  assert.equal(freeForAntics({ ...free, paused: true }), false);
  assert.equal(freeForAntics({ ...free, dragging: true }), false);
});

// ── The battery ─────────────────────────────────────────────────────────────

test("plugging in is delighted in once, not on every reading", () => {
  assert.equal(batteryReaction({ pct: 40, charging: false }, { pct: 40, charging: true }), "love");
  // Still charging: nothing more to say.
  assert.equal(batteryReaction({ pct: 41, charging: true }, { pct: 42, charging: true }), null);
});

test("dropping to the low mark is a startle, once", () => {
  assert.equal(batteryReaction({ pct: 21, charging: false }, { pct: 20, charging: false }), "surprised");
  // Already low: it stays low for a while, and he only jumped the first time.
  assert.equal(batteryReaction({ pct: 20, charging: false }, { pct: 19, charging: false }), null);
  assert.equal(batteryReaction({ pct: 19, charging: false }, { pct: 8, charging: false }), null);
  // The first reading he ever sees is a baseline, not a crossing — unless it
  // is already low, which is worth a startle.
  assert.equal(batteryReaction(null, { pct: 15, charging: false }), "surprised");
  assert.equal(batteryReaction(null, { pct: 80, charging: false }), null);
  assert.equal(batteryReaction(null, { pct: 80, charging: true }), "love");
});

test("a machine with no battery, or a reading that is not a number, says nothing", () => {
  assert.equal(batteryReaction({ pct: 50, charging: false }, null), null);
  assert.equal(batteryReaction(null, null), null);
  assert.equal(batteryReaction({ pct: 20, charging: false }, { pct: Number.NaN, charging: false }), null);
});

test("unplugging is not news, and neither is a battery in the middle", () => {
  assert.equal(batteryReaction({ pct: 80, charging: true }, { pct: 79, charging: false }), null);
  assert.equal(batteryReaction({ pct: 60, charging: false }, { pct: 59, charging: false }), null);
});
