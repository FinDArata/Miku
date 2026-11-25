// The dock (dock.html, dock.rs): Miku's own strip at the bottom of the
// screen, next to Windows' own taskbar, not instead of it. On the left the
// apps the user pinned — a click launches; on the right the windows that are
// open, one button per app: a click puts that app's window in front (a
// right-click puts every one of its windows away), and a "+" pins a new app
// with a name and the path of its exe.
//
// The strip draws from `dock_list`, polled while the dock is on screen; the
// icons ride in as data URIs (dock.rs), remembered per exe in memory.

import "./dock.css";
import { Bridge, onEvent, type DockWindow } from "../core/bridge";
import { language, onLanguageChange, resolveLanguage, setLanguage, systemLanguages, t } from "../i18n/i18n";
import { watchSkin } from "../theme/sync";
import type { Settings } from "../core/state";

type Pin = { name: string; path: string };

let settings: Settings | null = null;
let pins: Pin[] = [];
let windows: DockWindow[] = [];
/** Each exe's icon, remembered so the poll does not re-read them. */
const icons = new Map<string, string>();
let adding = false;

const root = document.getElementById("dock")!;

function button(cls: string, title: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

/** The app's icon when the Rust side found one, else the first letter on a
 * chip — the same shape the Notif page's avatars take. */
function iconOf(name: string, uri: string | null): HTMLElement {
  if (uri) {
    const img = document.createElement("img");
    img.src = uri;
    img.alt = "";
    img.draggable = false;
    return img;
  }
  const s = document.createElement("span");
  s.className = "dk-letter";
  s.textContent = (name.match(/\p{L}|\p{N}/u)?.[0] ?? "?").toUpperCase();
  return s;
}

/** The app's name, as the exe and the title bar tell it: the exe's own name
 * without its .exe, or the window title when the exe says nothing. */
function appLabel(exe: string, title: string): string {
  const stem = exe.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") ?? "";
  return stem || title || "?";
}

/** What the strip is showing right now, in one string: a rebuild that would
 * draw the same thing is skipped, so an idle strip re-decodes no icons and
 * touches no DOM — every two-second poll that finds no change costs nothing. */
let drawn = "";

function render() {
  const key = [
    language(),
    adding ? 1 : 0,
    pins.map((p) => `${p.name}|${p.path}`).join(";"),
    windows.map((w) => `${w.hwnd}|${w.title}|${w.exe}|${w.minimized ? 1 : 0}`).join(";"),
    icons.size,
  ].join("~");
  if (key === drawn && root.firstChild) return;
  drawn = key;

  const bar = document.createElement("div");
  bar.className = "dock-bar";

  // Pinned, in the order kept. A click launches through the Shell.
  for (const p of pins) {
    const b = button("dock-app", t("Open {name}", { name: p.name }), () => void Bridge.dockLaunch(p.path));
    b.append(iconOf(p.name, icons.get(`pin:${p.path}`) ?? null));
    bar.append(b);
  }

  // The windows that are open, one button per app: its newest window's icon,
  // a dot per window, hollow while every one of them is put away.
  const byApp = new Map<string, DockWindow[]>();
  for (const w of windows) {
    const key = w.exe || w.title;
    const list = byApp.get(key) ?? [];
    list.push(w);
    byApp.set(key, list);
  }
  for (const [key, list] of byApp) {
    const name = appLabel(list[0].exe, list[0].title);
    const away = list.every((w) => w.minimized);
    const b = button(
      away ? "dock-app live away" : "dock-app live",
      away ? t("Bring {name} up", { name }) : t("Focus {name} · right-click to put it away", { name }),
      () => Bridge.dockFocus((list.find((w) => !w.minimized) ?? list[list.length - 1]).hwnd),
    );
    b.append(iconOf(name, icons.get(key) ?? null));
    const dots = document.createElement("i");
    dots.className = "dk-dots";
    for (let n = 0; n < Math.min(list.length, 3); n++) {
      dots.append(document.createElement("em"));
    }
    b.append(dots);
    // A right-click puts the app's windows away, like a taskbar's.
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      for (const w of list) Bridge.dockMinimize(w.hwnd);
    });
    bar.append(b);
  }

  // The pin form: a name and the path of the exe, nothing more.
  const plus = button("dock-add", adding ? t("Done") : t("Pin an app"), () => {
    adding = !adding;
    render();
  });
  plus.textContent = adding ? "×" : "+";
  bar.append(plus);

  if (adding) {
    const form = document.createElement("div");
    form.className = "dock-form";
    const name = document.createElement("input");
    name.placeholder = t("Name");
    const path = document.createElement("input");
    path.placeholder = t("Path to the .exe");
    const add = document.createElement("button");
    add.className = "dock-ok";
    add.textContent = t("Pin");
    const noteDown = () => {
      const what = name.value.trim();
      const where = path.value.trim().replace(/^"|"$/g, "");
      if (!what || !where) return;
      pins.push({ name: what, path: where });
      adding = false;
      savePins();
      render();
    };
    add.addEventListener("click", noteDown);
    for (const input of [name, path]) {
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") noteDown();
      });
      // The strip never activates on a click (WS_EX_NOACTIVATE): the form is
      // the one thing that asks for the keyboard, and gives it back.
      input.addEventListener("mousedown", () => {
        void Bridge.dockFocusWindow(true);
        window.setTimeout(() => input.focus(), 60);
      });
      input.addEventListener("blur", () => void Bridge.dockFocusWindow(false));
    }
    form.append(name, path, add);
    bar.append(form);
  }

  root.replaceChildren(bar);
}

function savePins() {
  if (!settings) return;
  settings.dock = { shown: settings.dock?.shown ?? true, pins };
  void Bridge.saveSettings(settings);
}

/** The window list, read again while the dock is on screen. */
async function readWindows() {
  const list = await Bridge.dockList();
  if (!list) return;
  windows = list;
  // Icons new to this run: remembered per exe (and per pin path, so a pinned
  // app wears the icon its running window brought in).
  for (const w of windows) {
    const key = w.exe || w.title;
    if (w.icon && !icons.has(key)) icons.set(key, w.icon);
  }
  for (const p of pins) {
    const key = `pin:${p.path}`;
    if (!icons.has(key)) {
      const hit = windows.find((w) => w.exe.toLowerCase() === p.path.toLowerCase());
      if (hit?.icon) icons.set(key, hit.icon);
    }
  }
  render();
}

async function main() {
  const boot = await Bridge.boot();
  settings = boot?.settings ?? null;
  setLanguage(resolveLanguage(boot?.settings.language, systemLanguages()));
  void Bridge.setSystemLanguages(systemLanguages());
  watchSkin();
  pins = boot?.settings.dock?.pins ?? [];
  render();
  // Rust says the window really has Acrylic behind it: the strip goes
  // translucent, so the blur shows instead of hiding under it.
  void onEvent<null>("material", () => document.body.classList.add("acrylic"));

  // The poll only runs while the strip is on screen. WebView2 keeps a hidden
  // window's visibilityState at "visible", so Rust says it instead: the dock
  // window is created at launch (it must be, or it comes up blank) even when
  // the dock is off, and without this the page would walk the window list and
  // rebuild the bar every two seconds for ever, in a webview nobody sees.
  let timer: number | null = null;
  const stop = () => {
    if (timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
  const start = () => {
    if (timer == null) {
      void readWindows();
      timer = window.setInterval(() => void readWindows(), 2000);
    }
  };
  void onEvent<boolean>("dock-visible", (on) => (on ? start() : stop()));
  // The page could have been opened while the dock was already up (a manual
  // reload in dev): ask once, and a `false` answer just leaves it stopped.
  void Bridge.dockShown().then((on) => {
    if (on) start();
  });
}

void main();
onLanguageChange(() => render());
