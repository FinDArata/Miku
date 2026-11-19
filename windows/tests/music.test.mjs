// The pure rules that let her dance ride the system's music and her mouth ride
// the voice: band stats, dance energy, the bass-onset detector, and which skin
// carries which weather.

import { test } from "node:test";
import assert from "node:assert/strict";

const { musicEnergy, voiceLevel, bandStats, BeatTracker } = await import("../src/mochi/music.ts");
const { ambientFor } = await import("../src/mochi/ambient.ts");
const { skyTint } = await import("../src/mochi/sky.ts");
const { BreakTracker, nextMilestone, BREAK_AFTER_MS, BREAK_RESET_MS } = await import("../src/mochi/session.ts");
const { greetSignature } = await import("../src/mochi/greeting.ts");

// ── Energy and loudness ──────────────────────────────────────────────────────

test("dance energy: quiet stays still, loud caps out", () => {
  assert.equal(musicEnergy(0), 0);
  assert.ok(Math.abs(musicEnergy(0.2) - 0.32) < 1e-9); // 0.2 × 1.6
  assert.equal(musicEnergy(1), 1);
  assert.equal(musicEnergy(-1), 0);
});

test("voice loudness is a soft RMS over the bands", () => {
  assert.equal(voiceLevel([]), 0);
  assert.equal(voiceLevel([0, 0, 0]), 0);
  // All bands at the same level: exactly that level, leaning nowhere.
  assert.ok(Math.abs(voiceLevel([0.5, 0.5, 0.5, 0.5]) - 0.7) < 1e-9); // √0.25 × 1.4
  // One loud band among quiet ones pulls the level up, but never to full.
  const one = voiceLevel([1, 0, 0, 0]);
  assert.ok(one > 0 && one < 1);
});

test("band stats: rms over all of them, bass over the two lowest", () => {
  assert.deepEqual(bandStats([]), { rms: 0, bass: 0 });
  const s = bandStats([1, 0.5, 0, 0]);
  assert.ok(Math.abs(s.rms - Math.sqrt(1.25 / 4)) < 1e-9);
  assert.ok(Math.abs(s.bass - Math.sqrt(1.25 / 2)) < 1e-9);
  // Fewer than two bands: the bass is over what there is.
  assert.equal(bandStats([0.8]).bass, 0.8);
});

// ── The beat ─────────────────────────────────────────────────────────────────

test("a beat fires once on the onset, and again only after the bass recovers", () => {
  const beat = new BeatTracker();
  // Silence arms it.
  assert.equal(beat.push(0), false);
  assert.equal(beat.push(0), false);
  // The drop: one hit.
  assert.equal(beat.push(0.5), true);
  // Sustained, slowly climbing loudness is not new beats.
  assert.equal(beat.push(0.55), false);
  assert.equal(beat.push(0.6), false);
  // It sinks back to the average, arms itself, and the next hit lands.
  for (let i = 0; i < 60; i++) assert.equal(beat.push(0.05), false);
  assert.equal(beat.push(0.5), true);
});

test("a whisper of bass is not a beat, but the song's first hit is", () => {
  const beat = new BeatTracker();
  // Below the floor: never a beat, whatever the average says.
  assert.equal(beat.push(0.05), false);
  assert.equal(beat.push(0.05), false);
  assert.equal(beat.push(0.3), true);
});

// ── The weather ──────────────────────────────────────────────────────────────

test("each skin carries its own weather, and the classic carries none", () => {
  assert.equal(ambientFor("snow"), "snow");
  assert.equal(ambientFor("sakura"), "petal");
  assert.equal(ambientFor("classic"), "none");
});

// ── The hour's light ─────────────────────────────────────────────────────────

test("dawn warms, day is neutral, dusk violets, night cools", () => {
  assert.equal(skyTint(6).strength > 0, true);
  assert.equal(skyTint(12).strength, 0);
  assert.equal(skyTint(18).strength > 0, true);
  assert.equal(skyTint(2).strength > 0, true);
  // Dawn ends at 8, dusk begins at 17, night begins at 21.
  assert.equal(skyTint(8).strength, 0);
  assert.equal(skyTint(17).strength > 0, true);
  assert.equal(skyTint(21).strength > 0, true);
});

// ── The session ──────────────────────────────────────────────────────────────

test("a break is mentioned once per streak, and a long idle resets the clock", () => {
  const t = new BreakTracker();
  const min = 60_000;
  // Forty-nine minutes of work: not yet.
  assert.equal(t.update(true, 0), false);
  for (let m = 1; m <= 49; m++) assert.equal(t.update(true, m * min), false);
  // The fiftieth minute: once, and only once.
  assert.equal(t.update(true, 50 * min), true);
  assert.equal(t.update(true, 51 * min), false);
  assert.equal(t.update(true, 90 * min), false);
  // Idle past the reset, then back to work: the clock starts over.
  assert.equal(t.update(false, 91 * min), false);
  assert.equal(t.update(false, 91 * min + BREAK_RESET_MS), false);
  assert.equal(t.update(true, 91 * min + BREAK_RESET_MS + min), false);
  for (let m = 2; m <= 49; m++) assert.equal(t.update(true, 91 * min + BREAK_RESET_MS + m * min), false);
  // She came back at +1 min, so the fiftieth minute of work lands at +51.
  assert.equal(t.update(true, 91 * min + BREAK_RESET_MS + 51 * min), true);
});

test("brief pauses do not reset the break clock", () => {
  const t = new BreakTracker();
  const min = 60_000;
  assert.equal(t.update(true, 0), false);
  assert.equal(t.update(true, 25 * min), false);
  // A minute away, then back: the streak holds.
  assert.equal(t.update(false, 26 * min), false);
  assert.equal(t.update(true, 27 * min), false);
  assert.equal(t.update(true, 50 * min), true);
});

test("milestones fire in order, once, and never below what was shown", () => {
  assert.equal(nextMilestone([50, 100, 250], 0, 0), null);
  assert.equal(nextMilestone([50, 100, 250], 0, 60), 50);
  assert.equal(nextMilestone([50, 100, 250], 50, 300), 100);
  assert.equal(nextMilestone([50, 100, 250], 250, 300), null);
  // A jump past several lands on the smallest uncelebrated one.
  assert.equal(nextMilestone([50, 100, 250], 0, 300), 50);
});

// ── The hello ────────────────────────────────────────────────────────────────

test("the greeting's signature is stable per day and cycles through three", () => {
  assert.equal(greetSignature(0), "wave");
  assert.equal(greetSignature(1), "bow");
  assert.equal(greetSignature(2), "twirl");
  assert.equal(greetSignature(3), "wave");
  assert.equal(greetSignature(-1), "twirl");
  assert.equal(greetSignature(1234567), greetSignature(1234567));
});
