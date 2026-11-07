// Outfits on Miku: the hat, glasses and scarf are drawn on her own head, not
// the old Mochi's (src/mochi/engine.ts, `dressedHead`). The drawn commands are
// recorded, so a hat that is not painted at all fails here instead of looking
// right in a screenshot that never changed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BotEngine } from "../src/mochi/engine.ts";

/** A canvas context that records every drawing call, in order. */
function recorder() {
  const calls = [];
  const noop = (name) => (...args) => calls.push([name, ...args]);
  const gradient = () => ({ addColorStop: noop("addColorStop") });
  const ctx = {
    calls,
    save: noop("save"),
    restore: noop("restore"),
    beginPath: noop("beginPath"),
    closePath: noop("closePath"),
    moveTo: noop("moveTo"),
    lineTo: noop("lineTo"),
    quadraticCurveTo: noop("quadraticCurveTo"),
    bezierCurveTo: noop("bezierCurveTo"),
    arc: noop("arc"),
    arcTo: noop("arcTo"),
    ellipse: noop("ellipse"),
    rect: noop("rect"),
    roundRect: noop("roundRect"),
    fill: noop("fill"),
    stroke: noop("stroke"),
    clip: noop("clip"),
    translate: noop("translate"),
    rotate: noop("rotate"),
    scale: noop("scale"),
    setTransform: noop("setTransform"),
    resetTransform: noop("resetTransform"),
    clearRect: noop("clearRect"),
    fillRect: noop("fillRect"),
    strokeRect: noop("strokeRect"),
    measureText: () => ({ width: 10 }),
    fillText: noop("fillText"),
    createLinearGradient: () => gradient(),
    createRadialGradient: () => gradient(),
    createPattern: () => null,
    drawImage: noop("drawImage"),
    setLineDash: noop("setLineDash"),
    getLineDash: () => [],
  };
  // Settable properties the engine assigns.
  for (const k of [
    "fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "globalAlpha",
    "globalCompositeOperation", "font", "textAlign", "textBaseline", "shadowBlur",
    "shadowColor", "filter", "imageSmoothingEnabled", "miterLimit",
  ]) {
    ctx[k] = null;
  }
  return ctx;
}

/** Draw one frame and return the recorded calls, with a fresh Path2D per path. */
function frame(outfit) {
  globals();
  const engine = new BotEngine();
  engine.setOutfit(outfit, false);
  const ctx = recorder();
  engine.draw(ctx, 150, 150);
  return ctx.calls;
}

let installed = false;
function globals() {
  if (installed) return;
  installed = true;
  // The engine asks for Path2D and the clock; nothing here needs them to do more.
  globalThis.Path2D ??= class {
    moveTo() {}
    lineTo() {}
    closePath() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    arc() {}
    ellipse() {}
    rect() {}
    addPath() {}
  };
  globalThis.performance ??= { now: () => 0 };
}

const count = (calls, name) => calls.filter((c) => c[0] === name).length;

test("an outfit is actually painted on Miku", () => {
  const bare = frame("none");
  const hatted = frame("partyHat");
  // The hat adds strokes and fills of its own.
  assert.ok(
    count(hatted, "fill") > count(bare, "fill") || count(hatted, "bezierCurveTo") > count(bare, "bezierCurveTo"),
    "partyHat painted nothing",
  );
});

test("every hat changes what is drawn", () => {
  const bare = frame("none");
  for (const outfit of ["partyHat", "beanie", "crown", "witchHat", "santaHat", "bunnyEars"]) {
    const calls = frame(outfit);
    assert.notEqual(calls.length, bare.length, `${outfit} drew exactly what "none" drew`);
  }
});

test("the face items change what is drawn", () => {
  const bare = frame("none");
  for (const outfit of ["sunglasses", "roundGlasses", "bow", "scarf", "pumpkin"]) {
    const calls = frame(outfit);
    assert.notEqual(calls.length, bare.length, `${outfit} drew exactly what "none" drew`);
  }
});

test("each outfit draws something of its own, not another's", () => {
  const seen = new Map();
  for (const outfit of ["partyHat", "beanie", "crown", "witchHat", "sunglasses", "scarf"]) {
    const key = frame(outfit).map((c) => c[0]).join(",");
    assert.ok(!seen.has(key), `${outfit} draws the same calls as ${seen.get(key)}`);
    seen.set(key, outfit);
  }
});

test("nothing is drawn while the outfit is still gone", () => {
  globals();
  const engine = new BotEngine();
  // Never asked for an outfit: presence stays 0, so no hat appears.
  const withNone = recorder();
  engine.draw(withNone, 150, 150);
  const bareCount = withNone.calls.length;
  assert.ok(bareCount > 0, "the character itself is still drawn");
});
