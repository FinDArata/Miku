// The overlay's own right-click menu: the settings that belong to this little
// card, where the card is. Settings → General carries the same values; this is
// the shortcut, so the words can be made bigger or the card fainter without
// leaving what you are watching.
//
// Nothing here touches a whole `Settings`: the page knows only the look's six
// values, and `lyrics_set_look` writes just those.

import { t } from "../i18n/i18n";

export interface LookValues {
  opacity: number;
  fontSize: number;
  textColor: string;
  background: string;
  width: number;
  height: number;
}

/** What the menu needs from the page: the current look, and where to put it. */
export interface MenuHost {
  look(): LookValues;
  /** Applies a change: the caller stores it and repaints at once. */
  apply(patch: Partial<LookValues>): void;
  /** Which surface draws now, so the menu offers the way to the other one. */
  placement?(): "island" | "floating";
  /** Moves the words to the other surface. */
  setPlacement?(placement: "island" | "floating"): void;
  /** Opens the full settings window, for everything else. */
  openSettings(): void;
  /** Grows the window while the menu is up (the card is smaller than it). */
  grow(width: number, height: number): void;
  /** Puts the window back to the card's own size. */
  shrink(): void;
}

/** The card's margin, so the menu never sits under the window's rounded edge. */
const EDGE = 8;
/** The room the menu needs; below it the list scrolls instead of clipping. */
const MENU_W = 226;
const MENU_H = 268;

/**
 * Builds the menu once and keeps it in the document, hidden. A right-click
 * opens it at the pointer; anything else closes it.
 */
export function buildContextMenu(host: MenuHost): {
  open(x: number, y: number): void;
  close(): void;
  isOpen(): boolean;
} {
  const menu = document.createElement("div");
  menu.id = "lyrics-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  document.body.append(menu);

  let onClose: (() => void) | null = null;

  const close = () => {
    if (menu.hidden) return;
    menu.hidden = true;
    document.getElementById("lyrics")?.classList.remove("menu-open");
    host.shrink();
    onClose?.();
  };

  /** A labelled row holding one control, built fresh on every open. */
  const row = (label: string, control: HTMLElement) => {
    const el = document.createElement("div");
    el.className = "menu-row";
    const name = document.createElement("label");
    name.textContent = label;
    el.append(name, control);
    return el;
  };

  const heading = (text: string) => {
    const el = document.createElement("div");
    el.className = "menu-head";
    el.textContent = text;
    return el;
  };

  const slider = (
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    commit: (v: number) => void,
  ) => {
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    // `input` for the live preview, `change` is not needed: each move applies.
    input.addEventListener("input", () => commit(Number(input.value)));
    return row(label, input);
  };

  const colour = (label: string, value: string, commit: (v: string) => void) => {
    const input = document.createElement("input");
    input.type = "color";
    input.value = value;
    input.className = "menu-colour";
    input.addEventListener("input", () => commit(input.value));
    return row(label, input);
  };

  const open = (x: number, y: number) => {
    const look = host.look();
    menu.replaceChildren();

    menu.append(heading(t("The card")));
    menu.append(
      slider(t("Opacity"), 0, 1, 0.05, look.opacity, (v) => host.apply({ opacity: v })),
      slider(t("Text size"), 10, 40, 1, look.fontSize, (v) => host.apply({ fontSize: v })),
      slider(t("Width"), 200, 900, 10, look.width, (v) => host.apply({ width: v })),
      slider(t("Height"), 90, 400, 10, look.height, (v) => host.apply({ height: v })),
      colour(t("Text colour"), look.textColor, (v) => host.apply({ textColor: v })),
      colour(t("Card colour"), look.background, (v) => host.apply({ background: v })),
    );

    const sep = document.createElement("div");
    sep.className = "menu-sep";
    menu.append(sep);

    // The card can step back into the island, and the island's own menu brings
    // it back out: this is MiniLyrics' detach, one click away.
    const placement = host.placement?.() ?? "floating";
    const move = document.createElement("button");
    move.className = "menu-item";
    move.textContent = placement === "floating" ? t("Return to top") : t("Detach from top");
    move.addEventListener("click", () => {
      close();
      host.setPlacement?.(placement === "floating" ? "island" : "floating");
    });
    menu.append(move);

    const more = document.createElement("button");
    more.className = "menu-item";
    more.textContent = t("All settings…");
    more.addEventListener("click", () => {
      close();
      host.openSettings();
    });
    menu.append(more);

    // The menu is taller than the card: the window grows first, so nothing of
    // it is clipped, and it shrinks back when the menu closes. The card keeps
    // its own size (the `.menu-open` class), so it does not stretch with it.
    const card = document.getElementById("lyrics");
    card?.style.setProperty("--card-width", `${look.width}px`);
    card?.style.setProperty("--card-height", `${look.height}px`);
    card?.classList.add("menu-open");
    host.grow(Math.max(look.width, MENU_W), Math.max(look.height, MENU_H));
    menu.hidden = false;
    const box = menu.getBoundingClientRect();
    const maxX = window.innerWidth - box.width - EDGE;
    const maxY = window.innerHeight - box.height - EDGE;
    menu.style.left = `${Math.max(EDGE, Math.min(x, maxX))}px`;
    menu.style.top = `${Math.max(EDGE, Math.min(y, maxY))}px`;

    // Anything outside closes it: a click, Escape, or the pointer leaving the
    // window (the card is small, the menu fills it). These are bound after the
    // page's own handler has opened the menu, so a right-click inside it does
    // not close what it just opened.
    const away = (e: Event) => {
      if (e.target instanceof Node && menu.contains(e.target)) return;
      close();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    // The window itself is the real boundary; a move inside it must not close
    // the menu (the card grows to hold it, so the pointer is often over the
    // card's own area, not the menu's).
    const leave = (e: PointerEvent) => {
      if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        close();
      }
    };
    document.addEventListener("pointermove", leave);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    onClose = () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointermove", leave);
      window.removeEventListener("blur", close);
      onClose = null;
    };
  };

  return { open, close, isOpen: () => !menu.hidden };
}
