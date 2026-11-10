// Small pieces every settings section draws with.

import { h } from "../views/dom";
import { t, tn } from "../i18n/i18n";

export function statusDot(ok: boolean): HTMLElement {
  return h("i", { class: "dot", style: `background:${ok ? "#22c55e" : "#f4505e"}` });
}

export function renderDiff(text: string): HTMLElement {
  const box = h("div", { class: "diff" });
  for (const line of text.split("\n")) {
    const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
    box.append(h("div", { class: cls, text: line }));
  }
  return box;
}

/**
 * The rest of a list, behind one button: the rows the user is not using stay in
 * the page, folded rather than removed, so search can still reach them and the
 * switch that turns them on never moves.
 *
 * The fold is not a setting. It starts closed on every visit, because a fold
 * saved from last time is a default nobody can predict; one click to open is
 * cheaper than a stored field that drifts.
 */
export function fold(rows: HTMLElement[], label: (count: number) => string, startOpen = false): HTMLElement {
  const body = h("div", { class: "fold-body" });
  for (const row of rows) body.append(row);
  const button = h("button", { class: "fold-toggle", type: "button" }) as HTMLButtonElement;

  // Counted from the DOM, not from `rows.length`: a caller hands over whole
  // groups (a heading plus its rows), so counting the arguments said "1 other
  // tool" above twenty of them.
  const countRows = () => body.querySelectorAll(".pill-row, .fold-row").length;

  const setOpen = (open: boolean) => {
    button.setAttribute("aria-expanded", String(open));
    button.textContent = label(countRows());
    button.classList.toggle("open", open);
    body.hidden = !open;
  };
  button.addEventListener("click", () => setOpen(body.hidden));
  setOpen(startOpen);

  const wrap = h("div", { class: "fold" }, button, body);
  // Opening from outside (a search hit landing on a folded row).
  Object.defineProperty(wrap, "openFold", { value: () => setOpen(true) });
  return wrap;
}

/** The line above a folded block: how many rows are folded, in words. */
export function moreLabel(count: number): string {
  return tn("{count} other tool", "{count} other tools", count);
}

/** "Active" / "Not in use" next to a row's name, said once per row. */
export function rowState(on: boolean, detail: string | null): HTMLElement {
  return h("span", { class: "row-state", text: detail ?? (on ? t("In use") : "") });
}
