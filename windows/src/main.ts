// Entry point: boot the bridge, wire the island, start the greeting.

import "./style.css";
import { Bridge, IS_TAURI, onEvent } from "./core/bridge";
import { Sound } from "./core/sound";
import { State, type Settings } from "./core/state";
import { Island } from "./island/island";
import { registerHookHandlers } from "./island/hooks";
import { registerIntegrationHandlers, refreshConfigured } from "./island/integrations";
import { registerShortcutHandlers } from "./island/shortcuts";
import { registerVoiceHandlers } from "./island/voice";
import { applySpotify, registerSpotifyHandlers } from "./island/spotify";
import { registerWhatsAppHandlers } from "./island/whatsapp";
import { SPOTIFY_ID } from "./core/spotify";
import { voiceLevel } from "./mochi/music";
import { FlowBridge } from "./core/flow";
import { nextMilestone, STREAK_MILESTONES, WORD_MILESTONES } from "./mochi/session";
import { Recap } from "./recap/recap";
import { Updates } from "./island/update";
import { WhatsNew } from "./whats-new/controller";
import { onLanguageChange, resolveLanguage, setLanguage, systemLanguages } from "./i18n/i18n";
import { watchSkin } from "./theme/sync";

/** Shows the language Settings asks for ("" = the system's, when Miku has it). */
function applyLanguage() {
  setLanguage(resolveLanguage(State.settings.language, systemLanguages()));
}

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  // The island keeps its black notch, but its small accents (dots, progress,
  // glows) take the skin's colour like the rest of the app.
  watchSkin();

  void Sound.preload();

  // Before the island exists: its canvases size their bitmaps from the pixel
  // ratio once, so the zoom correction has to land first. If zoom was adjusted,
  // wait until the ratio updates (or up to 500ms) so nothing is sized against
  // the stale value.
  const dprBefore = window.devicePixelRatio || 1;
  const zoomChanged = await Bridge.fitZoom(dprBefore);
  if (zoomChanged) {
    for (let i = 0; i < 20 && window.devicePixelRatio === dprBefore; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  const island = new Island(root);
  // The dev previews (dev/*.html) drive the island from the console.
  if (import.meta.env.DEV) Object.assign(window, { __island: island, __state: State });

  const boot = await Bridge.boot();
  if (boot) {
    State.settings = { ...State.settings, ...boot.settings, lyricsPlacement: boot.settings.lyrics?.placement ?? boot.settings.lyricsPlacement ?? "island" };
  }
  // A language change redraws the island in place: the texts given as tl(…)
  // relabel themselves (views/dom.ts) and the views redraw the rest on this
  // sync. Nothing is rebuilt, so tasks, steps and the chat stay as they are.
  onLanguageChange(() => State.notify());
  applyLanguage();
  // Rust shows the tray and its errors in the same language as the webview.
  void Bridge.setSystemLanguages(systemLanguages());
  island.applySettings();
  State.loadIntegrationTasks();
  // The tray follows the agents: at work in teal, an ask in amber, trouble in
  // red, idle as herself. Only the changes are sent.
  let trayState: string | null | undefined;
  State.subscribe(() => {
    const raw = State.pendingApproval
      ? (State.pendingApproval.questions ? "question" : "approval")
      : State.paused ? null : State.effectiveState;
    const next =
      raw == null || raw === "idle" || raw === "sleeping" || raw === "dizzy" ? null : raw;
    if (next !== trayState) {
      trayState = next;
      void Bridge.trayState(next);
    }
  });
  if (boot && !boot.cursorPoll) island.followPageCursor();
  await island.desktop.init();

  await onEvent<{ x: number; y: number }>("cursor", ({ x, y }) => island.onCursor(x, y));
  await onEvent<boolean>("pointer-inside", (inside) => island.setPointerInside(inside));
  await onEvent<null>("closed-hover", () => island.wakeFromClosed());
  // She is on the mic (dictation, « OK Miku »): the island's Miku mouths along.
  await onEvent<number[]>("pill-bands", (bands) => island.setVoice(voiceLevel(bands)));
  // The system's music (music.rs): the dance rides the song's energy and beat.
  await onEvent<number[]>("music-bands", (bands) => island.setMusic(bands));

  /** Pause has to reach Rust too, or the pollers keep calling out. */
  const setPaused = (on: boolean) => {
    if (State.paused === on) return;
    State.paused = on;
    void Bridge.setPaused(on);
  };

  await onEvent<string>("tray", (what) => {
    switch (what) {
      case "settings":
        setPaused(false);
        island.alert("settings");
        break;
      case "open":
        setPaused(false);
        island.alert(State.defaultView());
        break;
      case "recap":
        setPaused(false);
        void Recap.open(island);
        break;
      case "wardrobe":
        setPaused(false);
        island.alert("wardrobe");
        break;
      // "Update Miku to X…", only in the menu while a new version is out.
      case "update":
        setPaused(false);
        Updates.show();
        break;
      case "pause":
        setPaused(!State.paused);
        if (State.paused) island.fsm.forceHidden();
        else island.reveal();
        break;
    }
  });

  const checkZoom = async () => {
    const dpr = window.devicePixelRatio || 1;
    await Bridge.fitZoom(dpr);
  };

  await onEvent<null>("screen-changed", async () => {
    await checkZoom();
    void Bridge.reposition();
    island.ensureRunning();
  });

  // A query only matches the ratio it was made for: once it changes, watch the
  // new one, or the next monitor's scale goes unnoticed and the zoom stays wrong.
  // One frame redraws Mochi at the new ratio, even while the loop is idle.
  const watchRatio = () => {
    window
      .matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      .addEventListener?.("change", () => {
        watchRatio();
        void checkZoom();
        island.ensureRunning();
      }, { once: true });
  };
  watchRatio();

  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false }
  );
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && (e.key === "+" || e.key === "-" || e.key === "=" || e.key === "0")) {
      e.preventDefault();
    }
  });

  // Settings → Reload sounds: read the sounds folder again, and let them hear it.
  await onEvent<null>("sounds-changed", () => {
    void Sound.reload().then(() => Sound.play("pop"));
  });

  // The settings window writes preferences; apply them here without a restart.
  await onEvent<Settings>("settings-changed", (s) => {
    const previousMain = State.mainPillId;
    State.settings = { ...State.settings, ...s, lyricsPlacement: s.lyrics?.placement ?? s.lyricsPlacement ?? State.settings.lyricsPlacement ?? "island" };
    applyLanguage();
    island.applySettings();
    State.loadIntegrationTasks();
    // A new main tool comes to the front, as on macOS.
    if (State.mainPillId !== previousMain) State.setFocus(State.mainPillId);
    void refreshConfigured();
  });

  registerHookHandlers(island);
  registerIntegrationHandlers(island);
  registerShortcutHandlers(island, () => setPaused(false));
  registerVoiceHandlers();
  registerSpotifyHandlers(island);
  registerWhatsAppHandlers(island);
  // LINE and Discord, from the notifications Windows shows (opt-in, Settings).
  void onEvent<{ app: string; title: string; body: string }>("pc-notification", (n) => island.pcNotification(n));
  // New versions: Rust offers the card, the island opens it when nothing else waits.
  await Updates.register(island);
  // Rust may have read Spotify before this page listened: ask once.
  if (State.settings.activeIntegrations.includes(SPOTIFY_ID)) {
    void Bridge.spotifyRefresh().then((s) => s && applySpotify(island, s));
  }

  // Monday recap: app start (greeting over), an agent starting work, waking up.
  const checkRecap = () => void Recap.check(island);
  // What's new, once after an update: when the greeting is over, or a few
  // seconds in when there is no greeting (the card waits for a quiet island).
  const whatsNew = () => void WhatsNew.launch(island);

  // A milestone worth a nod, from the dictation numbers: words in a day (once
  // per milestone per day) and days in a row (once per milestone, ever).
  const milestone = async () => {
    try {
      const s = await FlowBridge.stats();
      if (!s) return;
      const now = new Date();
      const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      const today = s.daily.at(-1)?.[1] ?? 0;
      const wordsShown = Number(localStorage.getItem(`miku.milestone.words.${dateKey}`) ?? 0);
      const words = nextMilestone(WORD_MILESTONES, wordsShown, today);
      if (words != null) {
        localStorage.setItem(`miku.milestone.words.${dateKey}`, String(words));
        island.ritual({ kind: "words", count: words });
        return;
      }
      const streakShown = Number(localStorage.getItem("miku.milestone.streak") ?? 0);
      const streak = nextMilestone(STREAK_MILESTONES, streakShown, s.streak);
      if (streak != null) {
        localStorage.setItem("miku.milestone.streak", String(streak));
        island.ritual({ kind: "streak", count: streak });
      }
    } catch {
      /* no numbers, no ritual */
    }
  };

  island.onGreetingDone = () => {
    checkRecap();
    whatsNew();
    void milestone();
  };
  window.setTimeout(whatsNew, 8000);
  window.setTimeout(milestone, 8000);
  island.onWake = checkRecap;
  await onEvent<null>("recap-check", checkRecap);

  island.launch();

  // In a plain browser there is no wake strip behind the cursor: make the whole
  // page wake the island so the visuals can be checked with `npm run dev`.
  if (!IS_TAURI) {
    document.addEventListener("click", () => Sound.resume(), { once: true });
  }
}

void main();
