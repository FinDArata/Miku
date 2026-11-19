// The System pill's card: the rules that turn a reading into what is drawn.
// The numbers themselves come from sysinfo (src-tauri/src/system_health.rs,
// tested there); this file is about colour thresholds, the short format, and
// refusing a reading that never arrived.

import { test } from "node:test";
import assert from "node:assert/strict";

const { heatColor, batteryColor, formatPct, formatMemory, WARN_AT, HOT_AT, BATTERY_LOW, BATTERY_CRITICAL, SYSTEM_ID } =
  await import("../src/views/system.ts");

test("the pill's id is the one Rust publishes under", () => {
  assert.equal(SYSTEM_ID, "integration_system");
});

test("a percentage is calm, then amber, then red", () => {
  assert.equal(heatColor(0), "#38BDF8");
  assert.equal(heatColor(WARN_AT - 1), "#38BDF8");
  assert.equal(heatColor(WARN_AT), "#F5A524");
  assert.equal(heatColor(HOT_AT - 1), "#F5A524");
  assert.equal(heatColor(HOT_AT), "#F4505E");
  assert.equal(heatColor(100), "#F4505E");
  // A reading that never arrived is not a hot one.
  assert.equal(heatColor(Number.NaN), "#38BDF8");
});

test("a battery is red only when it is both low and not charging", () => {
  assert.equal(batteryColor(80, false), "#38BDF8");
  assert.equal(batteryColor(BATTERY_LOW, false), "#F5A524");
  assert.equal(batteryColor(BATTERY_LOW + 1, false), "#38BDF8");
  assert.equal(batteryColor(BATTERY_CRITICAL, false), "#F4505E");
  assert.equal(batteryColor(BATTERY_CRITICAL - 1, false), "#F4505E");
  // Plugged in, a low battery is recovering: no alarm while it charges.
  assert.equal(batteryColor(5, true), "#22C55E");
  assert.equal(batteryColor(100, true), "#22C55E");
  assert.equal(batteryColor(Number.NaN, false), "#38BDF8");
});

test("a percentage is drawn as a whole number, never out of range", () => {
  assert.equal(formatPct(0), "0%");
  assert.equal(formatPct(42.4), "42%");
  assert.equal(formatPct(42.6), "43%");
  assert.equal(formatPct(100), "100%");
  // Clamped, so a driver's 104% is 100% on screen.
  assert.equal(formatPct(104), "100%");
  assert.equal(formatPct(-3), "0%");
  // Nothing to show is a dash, not "NaN%".
  assert.equal(formatPct(Number.NaN), "—");
});

test("memory reads as used out of total, in binary gigabytes", () => {
  const gb = 1024 ** 3;
  // The used figure keeps one decimal, so the row does not jump as memory moves.
  assert.equal(formatMemory(8 * gb, 16 * gb), "8.0 / 16 GB");
  assert.equal(formatMemory(7.84 * gb, 16 * gb), "7.8 / 16 GB");
  assert.equal(formatMemory(6.1 * gb, 15.9 * gb), "6.1 / 15.9 GB");
  assert.equal(formatMemory(3.2 * gb, 8 * gb), "3.2 / 8 GB");
  // No total to divide by: nothing to show.
  assert.equal(formatMemory(1 * gb, 0), "—");
  assert.equal(formatMemory(Number.NaN, 16 * gb), "—");
});
