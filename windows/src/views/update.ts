// The update card — port of UpdateCardView (MacUpdateViews.swift): the
// one-time question, "Miku X is out" with Update now · What's new · Later,
// then the download's progress, or what went wrong. Miku stands full-length
// on the stage, left of the card, as in the widget deck (dev/update-mockup.html).

import { h, clear } from "./dom";
import { headerLine, percent } from "../core/update";
import { Updates } from "../island/update";
import { State } from "../core/state";
import { CHIBI_H, CHIBI_W, drawChibi, type ChibiPose } from "../mochi/chibi";
import { parseVariant, resolveVariantNow } from "../mochi/wardrobe";
import { ctx2d } from "../core/canvas";
import type { ViewHost } from "./views";
import { language, t } from "../i18n/i18n";

function btn(label: string, kind: "primary" | "secondary", onClick: () => void): HTMLButtonElement {
  return h("button", { class: `btn ${kind}`, onclick: onClick }, h("span", { text: label }));
}

/** Her pose follows the card: asking, broken, done, at work, or announcing. */
function pose(): ChibiPose {
  const s = Updates.status;
  if (Updates.asking) return "question";
  if (s.phase.kind === "error") return "error";
  if (!s.latest) return "happy";
  if (s.phase.kind !== "idle") return "working";
  return "surprised";
}

export function buildUpdate(): ViewHost {
  const miku = h("canvas", { class: "up-miku" }) as HTMLCanvasElement;
  const kind = h("div", { class: "up-kind" });
  const title = h("div", { class: "title one-line" });
  const line = h("div", { class: "sub update-line" });
  const fill = h("div", { class: "fill" });
  const bar = h("div", { class: "update-bar" }, fill);
  const row = h("div", { class: "actions" });
  const stack = h("div", { class: "stack up-stack" }, kind, title, line, bar, row);
  const card = h("div", { class: "card" }, stack);
  const el = h("div", { class: "view up" }, h("div", { class: "up-main" }, h("div", { class: "up-left" }, miku), card));
  const started = performance.now();

  /** The mockup's small teal label over the title: what the card is about. */
  function kindLabel(): string {
    return Updates.status.phase.kind === "downloading" || Updates.status.phase.kind === "verifying" || Updates.status.phase.kind === "installing"
      ? t("Downloading")
      : t("Updates");
  }

  // The buttons are only rebuilt when what they offer changes: rebuilding them
  // between a mouse-down and a mouse-up would swallow the click.
  let rowKey = "";
  function buttons(state: string, make: () => HTMLElement[]) {
    const key = `${state}~${language()}`;
    if (key === rowKey) return;
    rowKey = key;
    clear(row);
    row.append(...make());
  }

  return {
    el,
    sync() {
      const s = Updates.status;
      const r = s.latest;
      const youHave = t("You have {version}", { version: s.current });
      kind.textContent = kindLabel();
      bar.style.display = "none";
      title.title = "";

      if (Updates.asking) {
        title.textContent = t("Get new versions from the island?");
        line.textContent = t("Miku checks her own releases on GitHub a few times a day and tells you when one is out. Nothing about you is sent.");
        buttons("ask", () => [
          btn(t("Yes, tell me"), "primary", () => Updates.answer(true)),
          btn(t("No thanks"), "secondary", () => Updates.answer(false)),
        ]);
        return;
      }

      const phase = s.phase;
      if (phase.kind === "error") {
        title.textContent = t("The update didn't go through");
        line.textContent = phase.message;
        buttons("error", () => [
          btn(t("Get it on GitHub"), "primary", () => Updates.openPage()),
          btn(t("OK"), "secondary", () => Updates.dismiss()),
        ]);
        return;
      }

      if (!r) {
        title.textContent = t("Miku is up to date");
        line.textContent = youHave;
        buttons("none", () => [btn(t("OK"), "secondary", () => Updates.dismiss())]);
        return;
      }

      title.textContent = t("Miku {version} is out", { version: r.version });
      title.title = title.textContent;
      switch (phase.kind) {
        case "downloading": {
          bar.style.display = "";
          fill.style.width = `${percent(phase.fraction)}%`;
          line.textContent = t("Downloading from GitHub… {percent} %", { percent: percent(phase.fraction) });
          buttons("busy", () => []);
          return;
        }
        case "verifying":
          line.textContent = t("Checking the download…");
          buttons("busy", () => []);
          return;
        case "installing":
          line.textContent = t("Installing… Miku closes and comes back by itself.");
          buttons("busy", () => []);
          return;
        case "idle":
          line.textContent = headerLine(r.headline, youHave);
          // The portable exe and Linux update the way they were installed: the release page.
          buttons(s.canInstall ? "install" : "page", () => s.canInstall
            ? [
              btn(t("Update now"), "primary", () => Updates.install()),
              btn(t("What's new"), "secondary", () => Updates.openPage()),
              btn(t("Later"), "secondary", () => Updates.later()),
            ]
            : [
              btn(t("Get it on GitHub"), "primary", () => Updates.openPage()),
              btn(t("Later"), "secondary", () => Updates.later()),
            ]);
          return;
      }
    },
    tick(now) {
      // Miku, every frame while the card is up.
      const x = ctx2d(miku);
      const w = miku.clientWidth;
      const hh = miku.clientHeight;
      if (x && w && hh) {
        const dpr = window.devicePixelRatio || 1;
        if (miku.width !== Math.round(w * dpr)) miku.width = Math.round(w * dpr);
        if (miku.height !== Math.round(hh * dpr)) miku.height = Math.round(hh * dpr);
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.clearRect(0, 0, miku.width, miku.height);
        const k = Math.min(miku.width / CHIBI_W, miku.height / CHIBI_H);
        x.setTransform(k, 0, 0, k, (miku.width - CHIBI_W * k) / 2, miku.height - CHIBI_H * k);
        drawChibi(x, pose(), (now - started) / 1000, resolveVariantNow(parseVariant(State.settings.mikuVariant)), { noShadow: true });
      }
      return true;
    },
  };
}
