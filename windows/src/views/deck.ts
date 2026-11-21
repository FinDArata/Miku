// The island's widget deck: what the island shows when it opens
// (docs/mockups/notch-widgets.png). Miku stands full-length on the left in a
// pose that follows the page; the page itself is a widget — the PC, the song,
// a focus timer, the weather, the next meeting, the agents. A bar on top
// switches pages (‹ ›, the page names, the mouse wheel).
//
// Data: the PC from widgets.rs (read every 3 s while that page is up), the song
// from the player (core/spotify.ts), the weather from Open-Meteo through
// widgets.rs once the user types a city, the meeting from the Cal.com pill
// when it is set up, the agents from State.tasks. The focus timer lives here.

import { h, svg } from "./dom";
import { ctx2d } from "../core/canvas";
import { ICONS } from "./icons";
import { appIcon } from "./appicons";
import type { ViewActions, ViewHost } from "./views";
import { Bridge, type SystemSnapshot, type WeatherNow } from "../core/bridge";
import { State } from "../core/state";
import { Spotify, currentArtwork, formatTime, spotifyPosition } from "../core/spotify";
import { CHIBI_H, CHIBI_W, drawChibi, type ChibiPose } from "../mochi/chibi";
import { parseVariant, resolveVariantNow } from "../mochi/wardrobe";
import { POKE_LINES } from "../mochi/poke";
import type { Sulk } from "../mochi/engine";
import { N_, language, t, tn } from "../i18n/i18n";
import { Shelf, ageLabel, colorOf, sizeLabel, tagOf, type ShelfFilter } from "../core/shelf";
import { HOST_OS } from "../core/pills";
import { Catch, HANDS } from "./catch";
import { agentLive, elapsed, splitStep } from "../core/agent-live";
import * as NoticeHistory from "../island/history";
import { Updates } from "../island/update";
import { isBusy, percent } from "../core/update";

export type DeckPage = "pc" | "music" | "focus" | "weather" | "meeting" | "agents" | "notif" | "shelf";

/** The page (and agent) the deck opens on next time, asked by a notice. */
let wanted: { page: DeckPage; agent?: string } | null = null;

/** Opens the deck on a page next time it shows — a notice about an agent opens on that agent. */
export function openDeckOn(page: DeckPage, agent?: string) {
  wanted = { page, agent };
}

/** How long an agent that finished still opens the deck on the Agents page. */
const RECENT_MS = 2 * 60_000;

/**
 * An agent at work or waiting, or one that finished in the last two minutes
 * (`lastStepAt` says when it last did something): the deck opens on them.
 */
export function agentsActive(
  tasks: readonly { id: string; isIntegration: boolean; state: string }[],
  lastStepAt: (id: string) => number | undefined,
  now = Date.now(),
): boolean {
  return tasks.some((x) => {
    if (x.isIntegration) return false;
    if (["working", "thinking", "searching", "approval", "question"].includes(x.state)) return true;
    const at = lastStepAt(x.id);
    return (x.state === "finished" || x.state === "error") && at != null && now - at < RECENT_MS;
  });
}
export const DECK_PAGES: readonly DeckPage[] = ["pc", "music", "focus", "weather", "meeting", "agents", "notif", "shelf"];

/** The next or previous page, wrapping round. */
export function stepPage(page: DeckPage, by: 1 | -1): DeckPage {
  const i = DECK_PAGES.indexOf(page);
  return DECK_PAGES[(i + by + DECK_PAGES.length) % DECK_PAGES.length];
}

/** WMO weather code → an icon and a few words. */
export function weatherLook(code: number): { icon: string; text: string } {
  if (code === 0) return { icon: "☀️", text: t("Clear") };
  if (code <= 2) return { icon: "🌤️", text: t("Partly cloudy") };
  if (code === 3) return { icon: "☁️", text: t("Cloudy") };
  if (code <= 48) return { icon: "🌫️", text: t("Fog") };
  if (code <= 57) return { icon: "🌦️", text: t("Drizzle") };
  if (code <= 67) return { icon: "🌧️", text: t("Rain") };
  if (code <= 77) return { icon: "🌨️", text: t("Snow") };
  if (code <= 82) return { icon: "🌧️", text: t("Showers") };
  return { icon: "⛈️", text: t("Thunderstorm") };
}

/** A machine busy enough to make Miku dizzy. */
export function pcStrained(s: { cpuPct: number; ramPct: number } | null): boolean {
  return !!s && (s.cpuPct >= 85 || s.ramPct >= 90);
}

/** How hard the machine works, for her pose on the PC page: calm, busy, strained. */
export function pcLoad(s: { cpuPct: number; ramPct: number } | null): "calm" | "busy" | "strained" {
  if (pcStrained(s)) return "strained";
  return s && (s.cpuPct >= 60 || s.ramPct >= 80) ? "busy" : "calm";
}

/** What a page's Miku needs to know to pick her pose. */
export interface PoseFacts {
  pcLoad: "calm" | "busy" | "strained";
  playing: boolean;
  /** The focus timer: "run" (focusing), "break", or "off" (not started or paused). */
  focus: "run" | "break" | "off";
  agentState: ChibiPose;
  rainSoon: boolean;
  unread: boolean;
  shelved: boolean;
}

/**
 * Miku's pose on each page: one of her own on every page, never the same
 * plain stand on all of them — at her laptop on the PC (thinking as it gets
 * busy, dizzy when it strains), holding her leek
 * while the music waits, ready (then thinking, then yawning) for a focus
 * round, a peace sign while no agent works.
 */
export function deckPose(page: DeckPage, f: PoseFacts): ChibiPose {
  switch (page) {
    case "pc": return f.pcLoad === "strained" ? "dizzy" : f.pcLoad === "busy" ? "thinking" : "working";
    case "music": return f.playing ? "singing" : "leek";
    case "focus": return f.focus === "run" ? "thinking" : f.focus === "break" ? "yawn" : "proud";
    case "weather": return f.rainSoon ? "approval" : "wave";
    case "meeting": return "finished";
    case "agents": return f.agentState === "idle" ? "wink" : f.agentState;
    case "notif": return f.unread ? "surprised" : "idle";
    case "shelf": return f.shelved ? "happy" : "wave";
  }
}

const FOCUS_MS = 25 * 60_000;
const BREAK_MS = 5 * 60_000;
const PC_EVERY_MS = 3000;
const WEATHER_EVERY_MS = 15 * 60_000;

const PAGE_NAMES: Record<DeckPage, string> = {
  pc: N_("PC"), music: N_("Music"), focus: N_("Focus"), weather: N_("Weather"), meeting: N_("Meeting"), agents: N_("Agents"), notif: N_("Notif"), shelf: N_("Shelf"),
};

function bar(pct: number, color: string): HTMLElement {
  const fill = h("i");
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  fill.style.background = color;
  return h("div", { class: "dk-bar" }, fill);
}

function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

/** "1.2 MB/s", "340 KB/s". */
export function rate(bytesPerSecond: number): string {
  const b = Math.max(0, bytesPerSecond || 0);
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)}M`;
  return `${Math.round(b / 1024)}K`;
}

function uptime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  return hrs > 0 ? `${hrs}h ${min}m` : `${min}m`;
}

export function buildDeck(actions: ViewActions): ViewHost {
  let page: DeckPage = "pc";

  // ── The bar on top ──
  const tabs = new Map<DeckPage, HTMLElement>();
  const tabRow = h("div", { class: "dk-tabs" });
  for (const p of DECK_PAGES) {
    const b = h("button", { class: "dk-tab", text: t(PAGE_NAMES[p]) });
    b.addEventListener("click", () => go(p));
    tabs.set(p, b);
    tabRow.append(b);
  }
  const arrow = (dir: 1 | -1) => {
    const b = h("button", { class: "dk-arrow", title: dir > 0 ? t("Next") : t("Previous"), text: dir > 0 ? "›" : "‹" });
    b.addEventListener("click", () => go(stepPage(page, dir)));
    return b;
  };
  const icon = (title: string, path: string, onClick: () => void, stroke?: number) => {
    const b = h("button", { class: "dk-icon", title }, svg(path, 15, stroke ? { stroke } : {}));
    b.addEventListener("click", onClick);
    return b;
  };
  // A new version waits: a lit chip on the bar, a click opens the update card.
  const update = h("button", { class: "dk-update" }) as HTMLButtonElement;
  update.addEventListener("click", () => Updates.show());
  const syncUpdate = () => {
    const s = Updates.status;
    update.hidden = !s.latest;
    if (!s.latest) return;
    update.textContent = s.phase.kind === "downloading" ? `↓ ${percent(s.phase.fraction)}%`
      : isBusy(s.phase) ? "…" : `↑ ${s.latest.version}`;
    update.title = t("Miku {version} is out", { version: s.latest.version });
  };
  syncUpdate();
  const top = h("div", { class: "dk-top" },
    arrow(-1), tabRow, arrow(1),
    h("div", { class: "grow" }),
    update,
    icon(t("Ask"), ICONS.bubbleRound, () => actions.setView("prompt")),
    icon(t("Settings"), ICONS.gearLine, () => actions.openSettingsWindow(), 1.6),
    icon(t("Close"), ICONS.xmark, () => actions.collapse()),
  );

  // ── Miku, full length ──
  const miku = h("canvas", { class: "dk-miku" }) as HTMLCanvasElement;
  // What she says while she sulks, over her head (mochi/poke.ts).
  const sulkSay = h("div", { class: "dk-sulk", role: "status" });
  let sulk: Sulk | null = null;
  const left = h("div", { class: "dk-left" }, h("div", { class: "dk-floor" }), miku, sulkSay);

  // ── Pages ──
  const body = h("div", { class: "dk-body" });

  // PC
  let pc: SystemSnapshot | null = null;
  let pcTimer: number | null = null;
  const readPc = async () => {
    pc = await Bridge.widgetSystem();
    if (page === "pc") render();
  };

  // Weather
  let weather: WeatherNow | null = null;
  let weatherAt = 0;
  let weatherBusy = false;
  /** The city field is open again (the user asked to change the city). */
  let editingCity = false;
  const readWeather = async (city: string) => {
    editingCity = false;
    weatherBusy = true;
    render();
    weather = await Bridge.widgetWeather(city);
    weatherAt = Date.now();
    // The capsule wears it too, small.
    State.weatherBrief = weather ? `${weatherLook(weather.code).icon} ${Math.round(weather.temp)}°` : null;
    weatherBusy = false;
    State.settings.weatherCity = city;
    render();
  };

  // Focus
  let focusEnd: number | null = null;
  let focusLeft = FOCUS_MS;
  let onBreak = false;
  let rounds = 0;

  function go(p: DeckPage) {
    page = p;
    // Leaving the Notif or Shelf page disarms its clear button.
    NoticeHistory.disarmClear();
    Shelf.disarmClear();
    render();
    tabs.get(p)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (p === "shelf") void Shelf.refresh();
    if (p === "pc") void readPc();
    const city = State.settings.weatherCity;
    if (p === "weather" && city && Date.now() - weatherAt > WEATHER_EVERY_MS) void readWeather(city);
  }

  function header(title: string, meta: string) {
    return h("div", { class: "dk-head" }, h("div", { class: "dk-title", text: title }), h("div", { class: "dk-meta", text: meta }));
  }
  function say(text: string) {
    return h("div", { class: "dk-say", text });
  }

  function pcPage(): HTMLElement {
    if (!pc) return h("div", {}, header(t("PC SPECS"), "…"), say(t("Reading the machine…")));
    const row = (k: string, pct: number, color: string, v: string) =>
      h("div", { class: "dk-row" }, h("span", { text: k }), bar(pct, color), h("span", { class: "dk-val", text: v }));
    const heat = (p: number) => (p >= 90 ? "#e8457c" : p >= 75 ? "#ffd36b" : "#39c5bb");
    const rows = [
      row(t("CPU"), pc.cpuPct, heat(pc.cpuPct), `${Math.round(pc.cpuPct)}% · ${pc.cores}c`),
      row("RAM", pc.ramPct, heat(pc.ramPct), `${gb(pc.ramUsed)}/${gb(pc.ramTotal)}G`),
    ];
    if (pc.diskTotal > 0) {
      const diskPct = (pc.diskUsed / pc.diskTotal) * 100;
      rows.push(row(t("Disk"), diskPct, diskPct >= 90 ? "#e8457c" : "#5fd37a", `${Math.round(diskPct)}% · ${Math.round(pc.diskTotal / 1024 ** 3)}G`));
    }
    const netPct = Math.min(100, (Math.log10(1 + pc.netDown / 1024) / 5) * 100);
    rows.push(row(t("Net"), netPct, "#8fa3ff", `↓${rate(pc.netDown)} ↑${rate(pc.netUp)}`));
    if (pc.battery) {
      rows.push(row(t("Batt"), pc.battery.pct, pc.battery.charging ? "#5fd37a" : pc.battery.pct <= 20 ? "#e8457c" : "#8fa3ff",
        `${Math.round(pc.battery.pct)}%${pc.battery.charging ? " ⚡" : ""}`));
    }
    const note = pcStrained(pc)
      ? `🥵 ${t("Heavy load!")}${pc.top ? ` ${t("Using the most:")} ${pc.top.name}` : ""}`
      : pc.top ? `${t("Busiest now:")} ${pc.top.name} (${Math.round(pc.top.cpuPct)}%)` : t("All calm.");
    return h("div", {}, header(t("PC SPECS"), `${t("Up")} ${uptime(pc.uptime)}`), ...rows, say(note));
  }

  function musicPage(): HTMLElement {
    const s = Spotify.state;
    const track = s.track;
    if (!track) return h("div", {}, header(t("MUSIC"), ""), say(t("Nothing playing")));
    const art = h("div", { class: "dk-art" });
    const cover = currentArtwork(s);
    if (cover) art.append(h("img", { src: cover, alt: "", draggable: "false" }));
    const d = track.duration;
    const pos = Math.min(d, spotifyPosition(s, Date.now()));
    const ctl = (path: string, label: string, onClick: () => void, cls = "dk-skip") => {
      const b = h("button", { class: cls, title: label }, svg(path, 13));
      b.addEventListener("click", onClick);
      return b;
    };
    return h("div", {},
      header(t("MUSIC"), /spotify/i.test(track.source ?? "") ? "Spotify" : t("Now playing")),
      h("div", { class: "dk-song" }, art, h("div", { class: "dk-song-text" },
        h("div", { class: "dk-song-title", text: track.title }),
        h("div", { class: "dk-song-artist", text: track.artist }))),
      h("div", { class: "dk-row dk-prog" }, h("span", { text: formatTime(pos) }), bar(d > 0 ? (pos / d) * 100 : 0, "linear-gradient(90deg,#39c5bb,#e8457c)"), h("span", { class: "dk-val", text: formatTime(d) })),
      h("div", { class: "dk-ctl" },
        ctl(ICONS.backward, t("Previous"), () => void Bridge.spotifyControl("previous")),
        ctl(s.playing ? ICONS.pause : ICONS.play, s.playing ? t("Pause") : t("Play"), () => void Bridge.spotifyControl("playPause"), "dk-play"),
        ctl(ICONS.forward, t("Next"), () => void Bridge.spotifyControl("next"))),
    );
  }

  function focusPage(): HTMLElement {
    const left = focusEnd != null ? Math.max(0, focusEnd - Date.now()) : focusLeft;
    const whole = onBreak ? BREAK_MS : FOCUS_MS;
    const ring = h("div", { class: "dk-ring" }, h("div", { text: formatTime(left / 1000) }));
    ring.style.setProperty("--done", `${(1 - left / whole) * 100}%`);
    const btn = (label: string, primary: boolean, onClick: () => void) => {
      const b = h("button", { class: primary ? "btn primary" : "btn secondary", text: label });
      b.addEventListener("click", onClick);
      return b;
    };
    const running = focusEnd != null;
    return h("div", {},
      header(onBreak ? t("BREAK") : t("FOCUS"), `${t("Pomodoro")} · ${t("Round")} ${rounds + 1}`),
      h("div", { class: "dk-focus" }, ring, h("div", { class: "dk-focus-side" },
        btn(running ? t("Pause") : t("Start"), true, () => {
          if (running) {
            focusLeft = Math.max(0, (focusEnd ?? 0) - Date.now());
            focusEnd = null;
          } else {
            focusEnd = Date.now() + focusLeft;
          }
          render();
        }),
        btn(t("Reset"), false, () => {
          focusEnd = null;
          onBreak = false;
          focusLeft = FOCUS_MS;
          render();
        }))),
      say(onBreak ? t("Stretch, drink some water.") : running ? t("Ganbatte! A break comes after this.") : t("25 minutes of focus, then 5 of rest.")),
    );
  }

  /** The place, as a button that opens the city field again. */
  function changeCity(place: string): HTMLElement {
    const b = h("button", { class: "dk-place", title: t("Change city"), text: `📍 ${place} ✎` });
    b.addEventListener("click", () => {
      editingCity = true;
      render();
      window.setTimeout(() => (body.querySelector(".dk-input") as HTMLInputElement | null)?.dispatchEvent(new MouseEvent("mousedown")), 0);
    });
    return b;
  }

  function weatherPage(): HTMLElement {
    const city = State.settings.weatherCity;
    const input = h("input", { class: "dk-input", placeholder: t("Type your city…"), value: city }) as HTMLInputElement;
    const ask = () => {
      const v = input.value.trim();
      if (v) void readWeather(v);
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") ask();
    });
    // The island takes the keyboard only while this field is used, as for the chat.
    input.addEventListener("mousedown", () => {
      void Bridge.focusWindow(true);
      window.setTimeout(() => input.focus(), 60);
    });
    input.addEventListener("blur", () => void Bridge.focusWindow(false));
    const set = h("button", { class: "btn secondary", text: t("Show") });
    set.addEventListener("click", ask);
    if (!city || editingCity || (!weather && !weatherBusy)) {
      return h("div", {}, header(t("WEATHER"), "open-meteo"),
        h("div", { class: "dk-city" }, input, set),
        say(city && !weatherBusy ? t("That city was not found. Try another name.") : t("Only the city you type is sent to Open-Meteo.")));
    }
    if (!weather) return h("div", {}, header(t("WEATHER"), city), say(t("Asking the sky…")));
    const look = weatherLook(weather.code);
    const rainSoon = weather.hours.some((x) => x.code >= 51);
    return h("div", {},
      h("div", { class: "dk-head" }, h("div", { class: "dk-title", text: t("WEATHER") }), changeCity(weather.place)),
      h("div", { class: "dk-weather" }, h("div", { class: "dk-big", text: `${Math.round(weather.temp)}°` }),
        h("div", { class: "dk-weather-text" }, h("div", { text: `${look.icon} ${look.text}` }),
          h("div", { class: "dk-dim", text: `${t("Humidity")} ${Math.round(weather.humidity)}% · ${Math.round(weather.wind)} km/h` }))),
      h("div", { class: "dk-hours" }, ...weather.hours.slice(1, 6).map((x) =>
        h("div", {}, h("span", { text: x.time }), h("b", { text: weatherLook(x.code).icon }), h("span", { text: `${Math.round(x.temp)}°` })))),
      say(rainSoon ? `☔ ${t("Rain is coming, bring an umbrella!")}` : t("No rain in the next hours.")),
    );
  }

  function meetingPage(): HTMLElement {
    const data = State.integrations.integration_calcom?.data as { bookings?: { start?: string; title?: string }[] } | undefined;
    const next = (data?.bookings ?? [])
      .map((b) => ({ ...b, at: new Date(String(b.start)).getTime() }))
      .filter((b) => Number.isFinite(b.at) && b.at > Date.now() - 5 * 60_000)
      .sort((a, b) => a.at - b.at)[0];
    if (!data) {
      const link = h("button", { class: "btn secondary", text: t("Open settings") });
      link.addEventListener("click", () => actions.openSettingsWindow());
      return h("div", {}, header(t("COMING UP"), "Cal.com"), say(t("Connect Cal.com to see your next meeting here.")), h("div", { class: "dk-ctl left" }, link));
    }
    if (!next) return h("div", {}, header(t("COMING UP"), "Cal.com"), say(t("No calls scheduled")));
    const mins = Math.max(0, Math.round((next.at - Date.now()) / 60_000));
    const when = new Date(next.at).toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" });
    return h("div", {},
      header(t("COMING UP"), "Cal.com"),
      h("div", { class: "dk-song-title", text: next.title ?? t("Meeting") }),
      h("div", { class: "dk-dim", text: when }),
      h("div", { class: "dk-big pink", text: mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m` }),
      h("div", { class: "dk-dim", text: t("until it starts") }),
    );
  }

  /** The agent the Agents page shows; the busiest one until the user picks. */
  let agentPick: string | null = null;

  function agentsPage(): HTMLElement {
    const tasks = State.tasks.filter((x) => !x.isIntegration);
    if (!tasks.length) return h("div", {}, header(t("AGENTS"), ""), say(t("No agent is running. Start Claude Code or Codex and Miku follows it.")));
    const busy = (x: (typeof tasks)[number]) => x.state === "working" || x.state === "thinking" || x.state === "searching";
    const task = tasks.find((x) => x.id === agentPick) ?? tasks.find(busy) ?? tasks[0];
    const live = agentLive(task.id);

    // One chip per agent; the dot glows while it works.
    const chips = h("div", { class: "ag-chips" }, ...tasks.slice(0, 5).map((x) => {
      const c = h("button", { class: x.id === task.id ? "ag-chip on" : "ag-chip", style: `--ac:${x.color}` },
        h("i", { class: busy(x) ? "live" : "" }), x.name);
      c.addEventListener("click", () => {
        agentPick = x.id;
        render();
      });
      return c;
    }));

    // What runs now (or how the turn ended).
    const now = (() => {
      if (live.running) {
        const [tool, what] = splitStep(live.running.label);
        return h("div", { class: "ag-now" },
          h("span", { class: "ag-spin" }), h("span", { class: "ag-tool", text: tool }),
          h("span", { class: "ag-cmd", text: what }),
          h("span", { class: "ag-el", text: elapsed(Date.now() - live.running.at) }));
      }
      const last = task.steps[task.steps.length - 1] ?? "";
      const icon = task.state === "finished" ? "✓" : task.state === "error" ? "✗" : task.state === "approval" || task.state === "question" ? "✋" : "•";
      return h("div", { class: `ag-now ${task.state}` }, h("span", { class: "ag-mark", text: icon }), h("span", { class: "ag-cmd", text: last }));
    })();

    const out = live.output
      ? h("div", { class: "ag-out" }, ...live.output.split("\n").slice(-3).map((l) =>
        h("div", { class: /error|fail|✗|exception/i.test(l) ? "bad" : "", text: l })))
      : null;

    const done = live.todos.filter((x) => x.status === "completed").length;
    const todos = live.todos.length
      ? h("div", { class: "ag-col" },
        h("div", { class: "ag-sec" }, `${t("TASKS")} ${done}/${live.todos.length}`,
          h("span", { class: "ag-pb" }, h("i", { style: `width:${(done / live.todos.length) * 100}%` }))),
        ...live.todos.slice(0, 4).map((x) => h("div", {
          class: `ag-todo ${x.status === "completed" ? "done" : x.status === "in_progress" ? "cur" : ""}`,
          text: `${x.status === "completed" ? "☑" : x.status === "in_progress" ? "▸" : "☐"} ${x.content}`,
        })))
      : null;
    const hist = live.history.slice(-3).reverse();
    const history = hist.length
      ? h("div", { class: "ag-col" }, h("div", { class: "ag-sec", text: t("HISTORY") }),
        ...hist.map((x) => h("div", { class: "ag-tl" },
          h("b", { text: new Date(x.at).toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" }) }), x.label)))
      : null;

    const where = task.sessionCwd ? task.sessionCwd.split(/[\\/]/).filter(Boolean).pop() ?? "" : "";
    return h("div", { class: "ag", style: `--ac:${task.color}` },
      chips,
      h("div", { class: "dk-head" }, h("div", { class: "dk-title", text: task.name.toUpperCase() }), h("div", { class: "dk-meta", text: where })),
      now,
      ...(out ? [out] : []),
      ...(todos || history ? [h("div", { class: todos && history ? "ag-cols" : "ag-cols one" }, ...(todos ? [todos] : []), ...(history ? [history] : []))] : []),
    );
  }

  /** The Notif page: what the notice cards said, newest first (island/history.ts). */
  function notifPage(): HTMLElement {
    const count = NoticeHistory.unreadCount();
    const badge = count > 0 ? h("span", { class: "nh-badge", text: t("{n} unread", { n: count }) }) : null;

    const filtersRow = h("div", { class: "nh-filters" }, ...NoticeHistory.filters().map((f) => {
      const b = h("button", { class: f.id === NoticeHistory.getFilter() ? "nh-filter on" : "nh-filter", text: t(f.name) });
      b.addEventListener("click", () => {
        NoticeHistory.setFilter(f.id);
        render();
      });
      return b;
    }));

    const head = h("div", { class: "nh-head" },
      h("div", { class: "dk-head", style: "margin-bottom:0" },
        h("div", { class: "dk-title nh-title", text: t("Notification history") }),
        badge),
      filtersRow);

    const entries = NoticeHistory.list();
    if (!entries.length) {
      return h("div", { class: "nh-page" }, head,
        h("div", { class: "nh-empty" },
          h("div", { class: "nh-empty-title", text: t("All caught up ✨") }),
          h("div", { class: "nh-empty-note", text: t("Notifications that passed stay here until you clear them — they never leave this computer.") })));
    }

    // Grouped: just now (today), yesterday, earlier — the mockup's order.
    const groups: { id: "today" | "yesterday" | "earlier"; name: string }[] = [
      { id: "today", name: t("just now") },
      { id: "yesterday", name: t("Yesterday") },
      { id: "earlier", name: t("Earlier") },
    ];
    const parts: HTMLElement[] = [];
    let lastGroup: string | null = null;
    for (const e of entries) {
      const g = NoticeHistory.groupOf(e.at);
      if (g !== lastGroup) {
        parts.push(h("div", { class: "nh-group", text: groups.find((x) => x.id === g)!.name.toUpperCase() }));
        lastGroup = g;
      }
      const who = h("span", { class: "nh-who", text: e.who || e.label });
      // Who first, then the app (its mark and name), then when.
      const src = h("div", { class: "nh-src" },
        who, appIcon(e.app, e.color), h("span", { class: "nh-app", text: e.label }),
        h("span", { class: "nh-time", text: NoticeHistory.timeOf(e.at) }));
      const body = h("div", { class: "nh-body" }, src,
        h("div", { class: "nh-msg", text: e.text }),
        ...(e.rom && State.settings.noticeRomanize !== false ? [h("div", { class: "nh-rom", text: e.rom })] : []));
      // What a click does: the chat app for LINE / Discord — at the chat the
      // app said its toast leads, when it said one, or the toast itself
      // pressed (its title is the entry's who) — the agent's page, otherwise
      // just read.
      const open = () => {
        NoticeHistory.markRead(e.id);
        if (e.app === "line" || e.app === "discord") void Bridge.openChatApp(e.app, e.target ?? null, e.who);
        if (e.kind === "agent") {
          agentPick = e.app;
          go("agents");
          return;
        }
        render();
      };
      const row = h("article", { class: e.read ? "nh-entry read" : "nh-entry unread", style: `--app:${e.color}`, title: e.label },
        h("i", { class: "nh-led" }), body);
      if (!e.read) {
        const seen = h("button", { class: "nh-seen", text: t("Mark as read") });
        seen.addEventListener("click", (ev) => {
          ev.stopPropagation();
          NoticeHistory.markRead(e.id);
        });
        body.append(h("div", { class: "nh-acts" }, seen));
      }
      row.addEventListener("click", open);
      parts.push(row);
    }

    const list = h("div", { class: "nh-list" }, ...parts);
    const clearBtn = h("button", { class: NoticeHistory.isClearing() ? "nh-clear-btn armed" : "nh-clear-btn", text: NoticeHistory.isClearing() ? t("Clear the history?") : t("Clear history") });
    clearBtn.addEventListener("click", () => {
      if (!NoticeHistory.isClearing()) {
        NoticeHistory.armClear();
        render();
      } else {
        NoticeHistory.clear();
        render();
      }
    });
    return h("div", { class: "nh-page" }, head, list, h("div", { class: "nh-clear" }, clearBtn));
  }

  /** The Shelf page (dev/miku-pages-mockup.html): what Miku caught, kept a week. */
  function shelfPage(): HTMLElement {
    const files = Shelf.files;
    const canDrag = HOST_OS === "windows";
    const link = (text: string, onClick: () => void, cls = "sh-link") => {
      const b = h("button", { class: cls, text });
      b.addEventListener("click", onClick);
      return b;
    };
    // Copies still running: a ghost tile for each, and room for the copy bar
    // (views/catch.ts draws it, a little Miku running it).
    const ghosts = Catch.ghosts();
    shelfKey = Catch.layoutKey();
    Catch.doneLabel = t("Done!");
    const copy = Catch.copyCount;
    const meta = copy.done < copy.count && ghosts.length
      ? t("Copying {done}/{count}…", copy)
      : files.length ? `${tn("{count} file", "{count} files", files.length)} · ${sizeLabel(Shelf.totalBytes)}` : "";
    const head = h("div", { class: "sh-head" },
      h("div", { class: "dk-title nh-title", text: t("Shelf") }),
      meta ? h("span", { class: "sh-meta", text: meta }) : null,
      h("div", { class: "grow" }),
      link(t("Open folder"), () => void Bridge.shelfReveal()),
      files.length ? link(Shelf.clearing ? t("Clear the shelf?") : t("Clear all"), () => void Shelf.clear(), Shelf.clearing ? "sh-link armed" : "sh-link dim") : null);
    // Files hovering the island: say where they go.
    const dropping = Catch.hovering > 0
      ? h("div", { class: "sh-drop" },
        h("b", { text: Catch.hovering > 1 ? t("Drop them here") : t("Drop it here") }),
        h("span", { text: Catch.hovering > 1 ? t("Miku will catch every one of them.") : t("Miku will catch it for you.") }))
      : null;
    if (dropping && !files.length) return h("div", { class: "nh-page" }, head, dropping);
    const bar = Catch.barShown ? h("div", { class: "sh-copy" }) : null;
    if (!files.length && !ghosts.length) {
      return h("div", { class: "nh-page" }, head,
        h("div", { class: "nh-empty" },
          h("div", { class: "nh-empty-title", text: t("Nothing on the shelf") }),
          h("div", { class: "nh-empty-note", text: t("Drop files on Miku and she keeps them here for a week.") })));
    }

    const kinds: { id: ShelfFilter; name: string }[] = [
      { id: "all", name: t("All") }, { id: "docs", name: t("Docs") }, { id: "images", name: t("Images") },
      { id: "audio", name: t("Audio") }, { id: "code", name: t("Code") },
    ];
    const filters = h("div", { class: "nh-filters" }, ...kinds.map((k) => {
      const b = h("button", { class: k.id === Shelf.filter ? "nh-filter on" : "nh-filter", text: k.name });
      b.addEventListener("click", () => Shelf.setFilter(k.id));
      return b;
    }));

    // A ghost holds the place of a file still copying: dashed, its own bar,
    // a check once copied; the real tile replaces it when the file lands.
    const ghostTiles = ghosts.map((g) => {
      const tag = tagOf(g.name);
      return h("div", { class: g.copied ? "sh-tile sh-ghost ok" : "sh-tile sh-ghost", title: g.name, "data-name": g.name, style: `--p:${g.progress}` },
        h("span", { class: "sh-doc", style: `--c:${colorOf(g.name)}` }, tag ? h("b", { text: tag }) : null),
        h("div", { class: "sh-name", text: g.name }),
        h("div", { class: "sh-prog" }, h("i")),
        h("div", { class: "sh-pct", text: `${Math.round(g.progress * 100)}%` }));
    });
    const ghostNames = new Set(ghosts.map((g) => g.name));
    const tiles = Shelf.shown().filter((f) => !ghostNames.has(f.name)).map((f) => {
      const tag = tagOf(f.name);
      const doc = h("span", { class: "sh-doc", style: `--c:${colorOf(f.name)}` }, tag ? h("b", { text: tag }) : null);
      const corner = (cls: string, title: string, text: string, onClick: () => void) => {
        const b = h("button", { class: cls, title, "aria-label": title, text });
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          onClick();
        });
        return b;
      };
      const tile = h("div", { class: Catch.waiting(f.name) ? "sh-tile sh-wait" : "sh-tile", tabindex: "0", role: "button", title: f.name, "data-name": f.name, draggable: canDrag ? "true" : "false" },
        corner("sh-go", t("Show in folder"), "↗", () => void Bridge.shelfReveal(f.name)),
        corner("sh-x", t("Take off the shelf"), "✕", () => void Shelf.remove(f.name)),
        doc,
        h("div", { class: "sh-name", text: f.name }),
        h("div", { class: "sh-size", text: `${sizeLabel(f.size)} · ${ageLabel(f.added)}` }));
      tile.addEventListener("click", () => void Bridge.shelfOpen(f.name));
      tile.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void Bridge.shelfOpen(f.name);
        }
      });
      // The page never drags a file itself: Windows' Shell does, with the real file.
      tile.addEventListener("dragstart", (e) => {
        e.preventDefault();
        void Bridge.shelfDrag([f.name]);
      });
      return tile;
    });
    const hint = `${canDrag ? t("Drag a file out to drop it anywhere · click to open") : t("Click a file to open it")} · ${t("Files leave the shelf after a week.")}`;
    return h("div", { class: "nh-page" }, head, dropping ?? bar ?? filters,
      h("div", { class: "nh-list" }, h("div", { class: "sh-grid" }, ...ghostTiles, ...tiles)),
      h("div", { class: "sh-hint", text: hint }));
  }

  /** The pose for the page (deckPose). */
  function pose(): ChibiPose {
    return actions.poked()?.pose ?? deckPose(page, {
      pcLoad: pcLoad(pc),
      playing: Spotify.state.playing,
      focus: focusEnd == null ? "off" : onBreak ? "break" : "run",
      agentState: State.effectiveState,
      rainSoon: weather?.hours.some((x) => x.code >= 51) ?? false,
      unread: NoticeHistory.unreadCount() > 0,
      shelved: Shelf.files.length > 0,
    });
  }

  /** Each page's built element and the key it was built from: a page the user
   * returns to is taken back up as it stands (its listeners included) unless
   * something it draws from has changed since. */
  const pageCache = new Map<DeckPage, { el: HTMLElement; key: string }>();

  function render() {
    for (const [p, b] of tabs) {
      b.classList.toggle("on", p === page);
      // The Notif tab wears a dot while something is still unread.
      b.classList.toggle("has-new", p === "notif" && NoticeHistory.unreadCount() > 0);
    }
    const key = pageKey(page);
    let entry = pageCache.get(page);
    // A page arriving — a switch, or the deck's first draw — may take the
    // cache back up as it stands; the page already on screen is always
    // redrawn, because its moving parts (the song, the timer, the machine)
    // live in this render and in the tick, not in the key.
    const arriving = !entry || body.firstChild !== entry.el;
    if (!entry || !arriving || entry.key !== key) {
      const built = { pc: pcPage, music: musicPage, focus: focusPage, weather: weatherPage, meeting: meetingPage, agents: agentsPage, notif: notifPage, shelf: shelfPage }[page]();
      built.classList.add("dk-page");
      entry = { el: built, key };
      pageCache.set(page, entry);
    }
    // A page that arrives plays its entrance; a refresh of what is already on
    // screen swaps without one, or the polls would flash it every second.
    // Mounting an element again replays the entrance on its own.
    entry.el.classList.toggle("dk-still", !arriving);
    if (body.firstChild !== entry.el) body.replaceChildren(entry.el);
  }

  /** What a page draws from: identical inputs draw an identical page, so a
   * sync that finds the cache's key still true skips the rebuild, and a page
   * switch the cache still answers is mounted without a rebuild (a
   * PlanCard.sync key per page). The keys of the big lists ask their stores'
   * version counters instead of stringifying the lot on every sync; the
   * moving parts — clocks, progress — stay with the per-second tick and each
   * action's own render(). */
  function pageKey(p: DeckPage): string {
    const lang = language();
    switch (p) {
      case "pc": return `pc|${lang}|${JSON.stringify(pc)}`;
      case "music": {
        const s = Spotify.state;
        const track = s.track;
        return track
          ? `music|${lang}|${track.id}|${track.title}|${track.artist}|${track.duration}|${track.source}|${s.playing}|${currentArtwork(s)}`
          : `music|${lang}|none`;
      }
      case "focus": return `focus|${lang}|${focusEnd}|${focusLeft}|${onBreak}|${rounds}|${Math.floor(Date.now() / 1000)}`;
      case "weather": return `weather|${lang}|${State.settings.weatherCity}|${editingCity}|${weatherBusy}|${JSON.stringify(weather)}`;
      case "meeting": return `meeting|${lang}|${JSON.stringify(State.integrations.integration_calcom?.data)}|${Math.floor(Date.now() / 60_000)}`;
      case "agents": {
        const tasks = State.tasks.filter((x) => !x.isIntegration);
        const task = tasks.find((x) => x.id === agentPick)
          ?? tasks.find((x) => x.state === "working" || x.state === "thinking" || x.state === "searching")
          ?? tasks[0];
        return `agents|${lang}|${agentPick}|${JSON.stringify(tasks)}|${task ? JSON.stringify(agentLive(task.id)) : ""}`;
      }
      case "notif": return `notif|${lang}|${NoticeHistory.unreadCount()}|${NoticeHistory.getFilter()}|${NoticeHistory.isClearing()}|${State.settings.noticeRomanize !== false}|${NoticeHistory.version()}|${Math.floor(Date.now() / 60_000)}`;
      case "shelf": return `shelf|${lang}|${Shelf.filter}|${Shelf.clearing}|${Catch.layoutKey()}|${Catch.hovering}|${Catch.barShown}|${Catch.copyCount.done}|${Catch.copyCount.count}|${Shelf.version()}|${JSON.stringify(Catch.ghosts())}`;
    }
  }

  // Files dropped on the island fall over the page into her hands, then fly
  // to their tiles (views/catch.ts): drawn on a sheet over the whole deck.
  const overlay = h("canvas", { class: "dk-catch" }) as HTMLCanvasElement;
  const main = h("div", { class: "dk-main" }, left, body, overlay);
  const el = h("div", { class: "view deck" }, top, main);
  let overlayDrawn = false;
  /** The catch's layout when the Shelf page last rendered (its bar, its ghosts). */
  let shelfKey = "";
  /** The canvases' last CSS size and pixel ratio: their backing store is
   * written only when one of them moves, not on every frame — a write clears
   * the canvas and dirties the layout the next read would flush. */
  let mikuW = 0;
  let mikuH = 0;
  let mikuDpr = 0;
  let overW = 0;
  let overH = 0;
  let overDpr = 0;

  /** The overlay's geometry: her hands, the page's top, and each file's tile. */
  function catchGeometry(): import("./catch").CatchGeometry {
    const box = main.getBoundingClientRect();
    const m = miku.getBoundingClientRect();
    const k = Math.min(m.width / CHIBI_W, m.height / CHIBI_H);
    const hands = {
      x: m.left - box.left + (m.width - CHIBI_W * k) / 2 + HANDS.x * k,
      y: m.top - box.top + m.height - CHIBI_H * k + HANDS.y * k,
    };
    const b = body.getBoundingClientRect();
    return {
      hands,
      from: { x: b.left - box.left + b.width * 0.5, y: 6 },
      tileAt(name) {
        const tile = [...body.querySelectorAll<HTMLElement>(".sh-tile")].find((x) => x.dataset.name === name);
        const doc = tile?.querySelector(".sh-doc")?.getBoundingClientRect();
        return doc ? { x: doc.left - box.left + doc.width / 2, y: doc.top - box.top + doc.height / 2 } : null;
      },
      bar: (() => {
        const r = body.querySelector(".sh-copy")?.getBoundingClientRect();
        return r ? { x: r.left - box.left, y: r.top - box.top + 22, w: r.width } : null;
      })(),
    };
  }

  const started = performance.now();
  let lastRender = 0;
  /** Whether the deck was on screen at the last sync (its opening is a change of this). */
  let shown = false;
  return {
    el,
    sync() {
      syncUpdate();
      // The PC page reads the machine while it is on screen, and only then.
      const want = State.mode === "expanded" && State.view === "overview";
      // Just opened: a notice's page first, else the agents while one is busy.
      // Just opened, or asked to switch while open (files dropped on the island).
      if (want && (!shown || wanted)) {
        if (wanted) {
          page = wanted.page;
          if (wanted.agent) agentPick = wanted.agent;
        } else if (agentsActive(State.tasks, (id) => agentLive(id).history.at(-1)?.at)) {
          page = "agents";
        }
        wanted = null;
        if (page === "shelf") void Shelf.refresh();
      }
      shown = want;
      if (want && pcTimer == null) {
        // Only the PC page shows it: reading the machine for any other page
        // (the Shelf, opened by a file dragged over the island) is wasted work.
        if (page === "pc") void readPc();
        pcTimer = window.setInterval(() => {
          if (!(State.mode === "expanded" && State.view === "overview")) {
            if (pcTimer != null) window.clearInterval(pcTimer);
            pcTimer = null;
            return;
          }
          if (page === "pc") void readPc();
        }, PC_EVERY_MS);
      }
      if (!el.querySelector(".dk-input:focus")) {
        // Rebuild unless the body already shows this page built from what it
        // draws from now — the page switch `go()` made has mounted its own.
        const cached = pageCache.get(page);
        if (!cached || cached.key !== pageKey(page) || body.firstChild !== cached.el) render();
      }
    },
    tick(now) {
      // Miku, every frame while the deck is up.
      const x = ctx2d(miku);
      const w = miku.clientWidth;
      const hh = miku.clientHeight;
      const variant = resolveVariantNow(parseVariant(State.settings.mikuVariant));
      const clock = (now - started) / 1000;
      if (x && w && hh) {
        const dpr = window.devicePixelRatio || 1;
        if (w !== mikuW || hh !== mikuH || dpr !== mikuDpr) {
          mikuW = w;
          mikuH = hh;
          mikuDpr = dpr;
          miku.width = Math.round(w * dpr);
          miku.height = Math.round(hh * dpr);
        }
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.clearRect(0, 0, miku.width, miku.height);
        const k = Math.min(miku.width / CHIBI_W, miku.height / CHIBI_H);
        x.setTransform(k, 0, 0, k, (miku.width - CHIBI_W * k) / 2, miku.height - CHIBI_H * k);
        // Catching dropped files, or else the page's own pose.
        if (!Catch.drawMiku(x, clock, variant)) drawChibi(x, pose(), clock, variant, { noShadow: true });
        // A new sulk pops a new line; its end lets the bubble fade.
        const mood = actions.poked();
        if (mood !== sulk) {
          sulk = mood;
          if (mood) {
            // The line she is saying out loud (BotEngine.slap plays its voice).
            sulkSay.textContent = t(POKE_LINES[mood.line].text);
            // Just over her hair ties (y ≈ 50 in the chibi's design space).
            const kc = Math.min(w / CHIBI_W, hh / CHIBI_H);
            sulkSay.style.top = `${hh - (CHIBI_H - 50) * kc}px`;
            sulkSay.classList.remove("on");
            void sulkSay.offsetWidth;
          }
          sulkSay.classList.toggle("on", mood != null);
        }
      }
      const catching = Catch.active;
      if (catching || overlayDrawn) {
        const ox = ctx2d(overlay);
        const ow = overlay.clientWidth;
        const oh = overlay.clientHeight;
        if (ox && ow && oh) {
          const dpr = window.devicePixelRatio || 1;
          if (ow !== overW || oh !== overH || dpr !== overDpr) {
            overW = ow;
            overH = oh;
            overDpr = dpr;
            overlay.width = Math.round(ow * dpr);
            overlay.height = Math.round(oh * dpr);
          }
          ox.setTransform(dpr, 0, 0, dpr, 0, 0);
          ox.clearRect(0, 0, ow, oh);
          if (catching) Catch.drawOverlay(ox, catchGeometry, clock, variant);
        }
        overlayDrawn = catching;
        Catch.sounds();
        main.classList.toggle("dropping", Catch.hovering > 0);
        if (page === "shelf" && Catch.layoutKey() !== shelfKey) render();
        // A tile shows once its file has landed on it (and pops in, in CSS).
        if (Catch.catching) {
          for (const tile of body.querySelectorAll<HTMLElement>(".sh-tile:not(.sh-ghost)")) {
            tile.classList.toggle("sh-wait", Catch.waiting(tile.dataset.name ?? ""));
          }
          // A ghost's copy, as it goes.
          const ghosts = Catch.ghosts();
          for (const tile of body.querySelectorAll<HTMLElement>(".sh-ghost")) {
            const g = ghosts.find((x) => x.name === tile.dataset.name);
            if (!g) continue;
            tile.style.setProperty("--p", String(g.progress));
            tile.classList.toggle("ok", g.copied);
            const pct = tile.querySelector(".sh-pct");
            if (pct) pct.textContent = `${Math.round(g.progress * 100)}%`;
          }
        }
      }
      // Clocks on the page (the song, the focus timer) move once a second.
      // The Agents page's running step shows how long it has been going.
      const agentRunning = page === "agents" && State.tasks.some((x) => agentLive(x.id).running);
      if (now - lastRender > 1000 && (page === "music" || agentRunning || (page === "focus" && focusEnd != null))) {
        lastRender = now;
        if (page === "focus" && focusEnd != null && Date.now() >= focusEnd) {
          // A round is over: focus → break → focus.
          if (!onBreak) rounds++;
          onBreak = !onBreak;
          focusLeft = onBreak ? BREAK_MS : FOCUS_MS;
          focusEnd = Date.now() + focusLeft;
          actions.blip();
        }
        render();
      }
      return true;
    },
  };
}
