// The Miku window's main menu: Miku big in the middle, the sections as bubbles
// over her head, her eyes (and chin) on the pointer. Picking one moves her to
// the left column, where she keeps striking poses, and opens the page on the right.

import { h } from "../views/dom";
import { t } from "../i18n/i18n";
import { THEMES, backdrop, liveMochi, miniMiku, stageWeather } from "./hero";
import { icon } from "./ui";
import type { PageId } from "./shell";
import type { ChibiPose } from "../mochi/chibi";
import type { PropName } from "./props";

interface MenuPage {
  id: PageId;
  icon: string;
  title: () => string;
}

/** Each bubble's Miku: a face of her own and the prop of the page. */
const BUBBLE_LOOKS: Partial<Record<PageId, [ChibiPose, PropName]>> = {
  home: ["happy", "house"],
  wardrobe: ["wink", "dress"],
  dictation: ["singing", "mic"],
  notes: ["working", "notepad"],
  words: ["searching", "book"],
  styles: ["love", "palette"],
  settingsView: ["thinking", "gear"],
  notch: ["proud", "leek"],
  mail: ["surprised", "letter"],
};

/**
 * `n` points on the arc over her head (184°…356° of an ellipse, in % of the
 * square stage), at equal steps along the curve: equal angles bunch the
 * bubbles up at the flat ends.
 */
export function arcSpots(n: number): [number, number][] {
  const at = (k: number): [number, number] => {
    const a = Math.PI * (1.02 + 0.96 * k);
    return [50 + Math.cos(a) * 80, 44 + Math.sin(a) * 46];
  };
  const STEPS = 240;
  const pts = Array.from({ length: STEPS + 1 }, (_, k) => at(k / STEPS));
  const len = [0];
  for (let k = 1; k <= STEPS; k++) len.push(len[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return Array.from({ length: n }, (_, i) => {
    const goal = (len[STEPS] * i) / Math.max(1, n - 1);
    return pts[len.findIndex((l) => l >= goal - 1e-9)];
  });
}

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
  const spots = arcSpots(pages.length);
  pages.forEach((p, i) => {
    const label = h("span", { text: p.title() });
    const face = h("canvas", { class: "hub-bubble-miku", "aria-hidden": "true" }) as HTMLCanvasElement;
    const [pose, prop] = BUBBLE_LOOKS[p.id] ?? ["happy", "house"];
    miniMiku(face, pose, prop);
    const b = h("button", { class: "hub-bubble", onclick: () => open(p.id) }, face, label);
    b.style.left = `${spots[i][0]}%`;
    b.style.top = `${spots[i][1]}%`;
    b.style.animationDelay = `${-(i * 0.57) % 4}s`;
    labels.push([label, p]);
    stage.append(b);
  });

  // On the left column she strikes the pose of the page's bubble.
  let shown: PageId = "home";
  const holdPose = () => engine.setHeldPose((BUBBLE_LOOKS[shown] ?? BUBBLE_LOOKS.home!)[0]);
  function open(page?: PageId) {
    if (page) pick(page);
    if (document.body.classList.contains("hub-open")) return;
    document.body.classList.add("hub-open");
    holdPose();
  }
  function close() {
    document.body.classList.remove("hub-open");
    engine.setHeldPose(null);
    engine.greet();
  }

  return {
    el,
    bg,
    /** The way back to the menu; the shell puts it in the panel's top bar. */
    back,
    /** Shows the page side without picking a page (a deep link already did). */
    open: () => open(),
    /** The section now shown (from a bubble, a chip or a deep link): her pose follows it. */
    follow(section: PageId) {
      shown = section;
      if (document.body.classList.contains("hub-open")) holdPose();
    },
    relabel() {
      for (const [label, p] of labels) label.textContent = p.title();
      backLabel.textContent = t("Back");
    },
  };
}
