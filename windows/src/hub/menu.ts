// The Miku window's main menu: Miku big in the middle, the sections as bubbles
// over her head, her eyes (and chin) on the pointer. Picking one moves her to
// the left column, where she keeps striking poses, and opens the page on the right.

import { h } from "../views/dom";
import { t } from "../i18n/i18n";
import { THEMES, backdrop, liveMochi, stageWeather } from "./hero";
import { icon } from "./ui";
import type { PageId } from "./shell";
import type { BotEmoteName } from "../core/layout";

interface MenuPage {
  id: PageId;
  icon: string;
  title: () => string;
}

const POSES: BotEmoteName[] = ["happy", "proud", "wink", "love"];
const POSE_EVERY_MS = 3500;

export function mainMenu(pages: MenuPage[], pick: (page: PageId) => void) {
  const canvas = h("canvas", { class: "hub-menu-miku" }) as HTMLCanvasElement;
  const stage = h("div", { class: "hub-menu-stage" }, canvas);
  const backLabel = h("span", { text: t("Back") });
  const back = h("button", { class: "hub-menu-back", onclick: () => close() }, icon("back"), backLabel);
  const el = h("div", { class: "hub-menu" }, stage);
  // Behind everything (the sidebar and the panel too): the bands' particles and
  // her variant's weather, over the whole window.
  const bgCanvas = h("canvas", { class: "hub-menu-bg" }) as HTMLCanvasElement;
  const weather = h("canvas", { class: "hub-menu-bg" }) as HTMLCanvasElement;
  const bg = h("div", { class: "hub-menu-backdrop", "aria-hidden": "true" }, bgCanvas, weather);
  backdrop(bgCanvas, THEMES.home.color, document.body, 0);
  stageWeather(weather);
  const engine = liveMochi(canvas);

  // An arc over her head, in % of the stage: 184°…356°.
  const labels: [HTMLElement, MenuPage][] = [];
  pages.forEach((p, i) => {
    const a = Math.PI * (1.02 + (0.96 * i) / Math.max(1, pages.length - 1));
    const label = h("span", { text: p.title() });
    const b = h("button", { class: "hub-bubble", onclick: () => open(p.id) }, icon(p.icon), label);
    b.style.left = `${50 + Math.cos(a) * 80}%`;
    b.style.top = `${44 + Math.sin(a) * 46}%`;
    b.style.animationDelay = `${-(i * 0.57) % 4}s`;
    labels.push([label, p]);
    stage.append(b);
  });

  let poseTimer = 0;
  function open(page?: PageId) {
    if (page) pick(page);
    if (document.body.classList.contains("hub-open")) return;
    document.body.classList.add("hub-open");
    let n = Math.floor(Math.random() * POSES.length);
    engine.triggerEmote(POSES[n], 2.2);
    window.clearInterval(poseTimer);
    poseTimer = window.setInterval(() => engine.triggerEmote(POSES[++n % POSES.length], 2.2), POSE_EVERY_MS);
  }
  function close() {
    window.clearInterval(poseTimer);
    document.body.classList.remove("hub-open");
    engine.greet();
  }

  return {
    el,
    bg,
    /** The way back to the menu; the shell puts it in the panel's top bar. */
    back,
    /** Shows the page side without picking a page (a deep link already did). */
    open: () => open(),
    relabel() {
      for (const [label, p] of labels) label.textContent = p.title();
      backLabel.textContent = t("Back");
    },
  };
}
