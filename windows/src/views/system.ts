// The System pill's card: CPU, memory, and the battery when the machine has
// one. What arrives is what src-tauri/src/system_health.rs read three seconds
// ago, already clamped to 0…100 there; this file only decides what a number
// looks like and which colour it earns.
//
// The rules are pure functions, tested in tests/system-health.test.mjs: a
// threshold that says "hot" is the sort of thing that silently drifts if it
// lives in the DOM code.

import { h, dot } from "./dom";
import { State } from "../core/state";
import { t } from "../i18n/i18n";

/** The pill's id — stable contract value shared with Rust. */
export const SYSTEM_ID = "integration_system";

/** One reading, as system_health.rs serialises it. */
export interface SystemHealth {
  cpuPct: number;
  ramPct: number;
  ramUsed: number;
  ramTotal: number;
  battery: { pct: number; charging: boolean } | null;
}

/** Where a percentage stops being comfortable, and starts being a problem. */
export const WARN_AT = 75;
export const HOT_AT = 90;
/** A battery under this is worth noticing; under the second, worth saying. */
export const BATTERY_LOW = 20;
export const BATTERY_CRITICAL = 10;

/** The colour a percentage is drawn in: calm, warning, or hot. */
export function heatColor(pct: number): string {
  if (!Number.isFinite(pct)) return "#38BDF8";
  if (pct >= HOT_AT) return "#F4505E";
  if (pct >= WARN_AT) return "#F5A524";
  return "#38BDF8";
}

/** A battery's colour, which is about being low rather than being busy. */
export function batteryColor(pct: number, charging: boolean): string {
  if (!Number.isFinite(pct)) return "#38BDF8";
  // Plugged in, a low battery is recovering: no alarm while it charges.
  if (charging) return "#22C55E";
  if (pct <= BATTERY_CRITICAL) return "#F4505E";
  if (pct <= BATTERY_LOW) return "#F5A524";
  return "#38BDF8";
}

/** "42%": whole numbers, since a tenth of a percent is noise on a pill. */
export function formatPct(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  return `${Math.round(Math.min(100, Math.max(0, pct)))}%`;
}

/**
 * Memory as one short line: "7.8 / 16 GB". The used figure keeps one decimal
 * (so the row does not jump as memory moves); the total drops a trailing zero,
 * because a machine's memory is a round number in practice.
 */
export function formatMemory(used: number, total: number): string {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return "—";
  const gb = (bytes: number) => Math.max(0, bytes) / 1024 ** 3;
  const whole = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
  return `${gb(used).toFixed(1)} / ${whole(gb(total))} GB`;
}

/** The reading in the island's copy, or null when the pill has not reported. */
export function readHealth(): SystemHealth | null {
  const data = State.integrations[SYSTEM_ID]?.data as unknown as SystemHealth | undefined;
  if (!data || typeof data.cpuPct !== "number") return null;
  return data;
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function gauge(pct: number, color: string, label: string, detail?: string): HTMLElement {
  const value = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  const bar = h("div", { class: "sys-bar" });
  const fill = h("i", { class: "sys-fill" });
  fill.style.width = `${value}%`;
  fill.style.background = color;
  bar.append(fill);
  const row = h(
    "div",
    { class: "sys-gauge" },
    h("span", { class: "sys-label", text: label }),
    h("span", { class: "sys-value", style: `color:${color}`, text: formatPct(pct) }),
  );
  if (detail) row.append(h("span", { class: "sys-detail", text: detail }));
  return h("div", { class: "sys-item" }, row, bar);
}

/** The card. `null` reads as "nothing yet", which is what the first frame is. */
export function buildSystemCard(): { el: HTMLElement; sync(): void } {
  const el = h("div", { class: "int-card" });
  const sync = () => {
    const health = readHealth();
    el.replaceChildren();
    el.append(
      h("div", { class: "int-head" }, dot("#38BDF8", 7), h("b", { text: t("System") }), h("span", { text: t("This computer") })),
    );
    if (!health) {
      el.append(h("div", { class: "int-status", text: t("Reading…") }));
      return;
    }
    const body = h("div", { class: "sys-gauges" });
    body.append(gauge(health.cpuPct, heatColor(health.cpuPct), t("CPU")));
    body.append(gauge(health.ramPct, heatColor(health.ramPct), t("Memory"), formatMemory(health.ramUsed, health.ramTotal)));
    if (health.battery) {
      const color = batteryColor(health.battery.pct, health.battery.charging);
      body.append(
        gauge(
          health.battery.pct,
          color,
          t("Battery"),
          health.battery.charging ? t("Charging") : undefined,
        ),
      );
    }
    el.append(body);
  };
  sync();
  return { el, sync };
}
