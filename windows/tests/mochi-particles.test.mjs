// Particles only pile up while someone draws them (src/mochi/engine.ts): an
// unfocused window pauses its frames, timers keep emitting, and a backlog used
// to burst out all at once — stars bunched over her head and a stutter — the
// moment the window was clicked again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BotEngine } from "../src/mochi/engine.ts";

const count = (e) => e.particles.length;

test("an engine that is drawn emits its particles", () => {
  const e = new BotEngine();
  e.update(0.016);
  e.emit("star", 5);
  assert.equal(count(e), 5);
});

test("with no frame for a second, emits are dropped instead of piling up", () => {
  const e = new BotEngine();
  e.update(0.016);
  e.lastUpdateMs = performance.now() - 5000; // frames paused (window unfocused)
  for (let i = 0; i < 200; i++) e.emit("spark", 3);
  e.puff();
  assert.equal(count(e), 0);
  // Frames come back: it emits again at once.
  e.update(0.016);
  e.emit("heart", 2);
  assert.equal(count(e), 2);
});

test("however much is emitted between two frames, a frame keeps at most a screenful", () => {
  const e = new BotEngine();
  e.update(0.016);
  for (let i = 0; i < 100; i++) e.emit("spark", 5);
  e.update(0.001);
  assert.ok(count(e) <= 60, `${count(e)} particles after one frame`);
});
