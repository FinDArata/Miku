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
import { ICONS } from "./icons";
import type { ViewActions, ViewHost } from "./views";
import { Bridge, type SystemSnapshot, type WeatherNow } from "../core/bridge";
import { State } from "../core/state";
import { Spotify, currentArtwork, formatTime, spotifyPosition } from "../core/spotify";
import { CHIBI_H, CHIBI_W, drawChibi, type ChibiPose } from "../mochi/chibi";
import { parseVariant, resolveVariant } from "../mochi/wardrobe";
import { N_, language, t } from "../i18n/i18n";
import { agentLive, elapsed, splitStep } from "../core/agent-live";

export type DeckPage = "pc" | "music" | "focus" | "weather" | "meeting" | "agents";
export const DECK_PAGES: readonly DeckPage[] = ["pc", "music", "focus", "weather", "meeting", "agents"];

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

const FOCUS_MS = 25 * 60_000;
const BREAK_MS = 5 * 60_000;
const PC_EVERY_MS = 3000;
const WEATHER_EVERY_MS = 15 * 60_000;

const PAGE_NAMES: Record<DeckPage, string> = {
  pc: N_("PC"), music: N_("Music"), focus: N_("Focus"), weather: N_("Weather"), meeting: N_("Meeting"), agents: N_("Agents"),
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
  const top = h("div", { class: "dk-top" },
    arrow(-1), tabRow, arrow(1),
    h("div", { class: "grow" }),
    icon(t("Ask"), ICONS.bubbleRound, () => actions.setView("prompt")),
    icon(t("Settings"), ICONS.gearLine, () => actions.openSettingsWindow(), 1.6),
    icon(t("Close"), ICONS.xmark, () => actions.collapse()),
  );

  // ── Miku, full length ──
  const miku = h("canvas", { class: "dk-miku" }) as HTMLCanvasElement;
  const left = h("div", { class: "dk-left" }, h("div", { class: "dk-floor" }), miku);

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
    render();
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

  /** The pose for the page, as the mockup draws her. */
  function pose(): ChibiPose {
    switch (page) {
      case "pc": return pcStrained(pc) ? "dizzy" : "idle";
      case "music": return Spotify.state.playing ? "singing" : "idle";
      case "focus": return focusEnd != null && !onBreak ? "working" : "idle";
      case "weather": return weather?.hours.some((x) => x.code >= 51) ? "approval" : "wave";
      case "meeting": return "finished";
      case "agents": return State.effectiveState;
    }
  }

  function render() {
    for (const [p, b] of tabs) b.classList.toggle("on", p === page);
    const content = { pc: pcPage, music: musicPage, focus: focusPage, weather: weatherPage, meeting: meetingPage, agents: agentsPage }[page]();
    content.classList.add("dk-page");
    body.replaceChildren(content);
  }

  const el = h("div", { class: "view deck" }, top, h("div", { class: "dk-main" }, left, body));
  // The mouse wheel flips pages, one notch at a time.
  let wheelAt = 0;
  el.addEventListener("wheel", (e) => {
    const now = performance.now();
    if (now - wheelAt < 250) return;
    wheelAt = now;
    go(stepPage(page, (e.deltaY || e.deltaX) > 0 ? 1 : -1));
  }, { passive: true });

  const started = performance.now();
  let lastRender = 0;
  return {
    el,
    sync() {
      // The PC page reads the machine while it is on screen, and only then.
      const want = State.mode === "expanded" && State.view === "overview";
      if (want && pcTimer == null) {
        void readPc();
        pcTimer = window.setInterval(() => {
          if (!(State.mode === "expanded" && State.view === "overview")) {
            if (pcTimer != null) window.clearInterval(pcTimer);
            pcTimer = null;
            return;
          }
          if (page === "pc") void readPc();
        }, PC_EVERY_MS);
      }
      if (!el.querySelector(".dk-input:focus")) render();
    },
    tick(now) {
      // Miku, every frame while the deck is up.
      const x = miku.getContext("2d");
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
        drawChibi(x, pose(), (now - started) / 1000, resolveVariant(parseVariant(State.settings.mikuVariant), new Date()), { noShadow: true });
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
