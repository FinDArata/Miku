// SoundEngine — port of SoundEngine.swift.
// The WAVs are the macOS app's own files (see SOUNDS_DIR in vite.config.ts);
// they are served at /sounds/<name>.wav. Default volume 0.12, slider range 0–0.2,
// exactly like the Mac player, and several sounds may overlap.
// A file of the user's own in the sounds folder (src-tauri/src/sounds.rs)
// replaces a sound; one that doesn't decode falls back to the built-in one.

import { Bridge } from "./bridge";

export const SOUND_NAMES = [
  "peek", "open", "close", "hover", "blip", "slap", "annoyed", "dizzy", "greet",
  "work", "finish", "error", "approval", "question", "approve", "gulp", "tick",
  "send", "love", "pop", "proud", "wink", "yawn", "attach", "think", "search",
  "rate", "sleep", "greeting", "slide",
  // The launch greetings, one at random (voice/, scripts/voice-cues.mjs).
  "greeting-matteta", "greeting-yoroshiku", "greeting-ganbarou", "greeting-konbanwa",
  // Spoken only (voice/): who rang, a break, a file caught on the shelf.
  "app-line", "app-whatsapp", "app-discord", "app-claude", "app-codex", "app-cursor",
  "app-gemini", "app-copilot", "app-agent", "app-notice", "app-mail", "app-update",
  "break", "catch",
  // Her sulk after three pokes, the line in her bubble (src/mochi/poke.ts).
  "poke-stop", "poke-hmph", "poke-enough", "poke-silent", "poke-rude", "poke-work",
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

/**
 * Where a notice comes from, each with a sound of its own (Settings → General).
 * The slot's name is also the file of the user's own in the sounds folder
 * (line.mp3, agent.wav…): lowercase letters only, as sounds.rs asks.
 */
export const NOTIFY_SLOTS = ["line", "whatsapp", "discord", "agent", "notice"] as const;
export type NotifySlot = (typeof NOTIFY_SLOTS)[number];
/** The choice for a slot: "" = Miku's usual sound, "none", "file", or a built-in name. */
export type NotifyChoice = Partial<Record<NotifySlot, string>>;

/**
 * The cues scripts/voice-cues.mjs lays over the chimes, or adds. A neural voice
 * detuned by more than a hair sounds wrong, so they jitter far less than the
 * composed chimes — which need the variation to stay fresh on the hundredth
 * play of a day.
 */
const SPOKEN = new Set([
  "approve", "blip", "error", "finish", "greeting", "question",
  "approval", "rate", "work", "love", "dizzy", "annoyed", "slap", "break", "catch",
]);
const isSpoken = (name: string) => SPOKEN.has(name) || name.startsWith("greeting-") || name.startsWith("app-") || name.startsWith("poke-");

/** The agents Miku names when they finish (voice/app-<id>.wav); the rest are "the agent". */
const NAMED_AGENTS = new Set(["codex", "cursor", "gemini", "copilot"]);
/** The finish line for an agent: Claude Code (no miku_agent) is "Claude". */
export function agentVoice(agent: string | null): string {
  if (!agent) return "app-claude";
  return NAMED_AGENTS.has(agent) ? `app-${agent}` : "app-agent";
}

class SoundEngine {
  enabled = true;
  volume = 0.12;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private idleTimer: number | null = null;
  /** The sounds a file of the user's own replaces, as last loaded. */
  customized = new Set<string>();
  /** Settings.notifySounds, kept in step by the windows that play notices. */
  notifyChoices: NotifyChoice = {};
  /** Sounds still playing, by name, so one can be faded out (the greeting). */
  private playing = new Map<string, Set<{ src: AudioBufferSourceNode; gain: GainNode }>>();

  /** Creates the context and decodes every WAV. Safe to call more than once. */
  preload(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.volume;
      master.connect(ctx.destination);
      this.master = master;
      await this.loadAll(ctx);
    })();
    return this.loading;
  }

  /** Reads the sounds folder again (Settings → Reload sounds). */
  async reload(): Promise<void> {
    await this.preload();
    if (this.ctx) await this.loadAll(this.ctx);
  }

  private async loadAll(ctx: AudioContext) {
    const own = new Set((await Bridge.customSounds([...SOUND_NAMES, ...NOTIFY_SLOTS])) ?? []);
    const customized = new Set<string>();
    // A notice slot has no built-in sound: only the user's file, when there is one.
    for (const slot of NOTIFY_SLOTS) this.buffers.delete(slot);
    await Promise.all(
      NOTIFY_SLOTS.filter((slot) => own.has(slot)).map(async (slot) => {
        try {
          const bytes = await Bridge.customSound(slot);
          if (bytes && bytes.byteLength > 0) {
            this.buffers.set(slot, await ctx.decodeAudioData(bytes));
            customized.add(slot);
          }
        } catch {
          /* undecodable: the slot plays its usual sound */
        }
      }),
    );
    await Promise.all(
      SOUND_NAMES.map(async (name) => {
        if (own.has(name)) {
          try {
            const bytes = await Bridge.customSound(name);
            if (bytes && bytes.byteLength > 0) {
              this.buffers.set(name, await ctx.decodeAudioData(bytes));
              customized.add(name);
              return;
            }
          } catch {
            /* not a format this webview decodes: the built-in sound stays */
          }
        }
        try {
          const res = await fetch(`/sounds/${name}.wav`);
          if (!res.ok) return;
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(name, buf);
        } catch {
          /* a missing sound must never break the island */
        }
      }),
    );
    this.customized = customized;
  }

  /** WebView2 can hand us a suspended context; call after any user input. */
  resume() {
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    void this.ctx?.resume();
  }

  /**
   * Called when the island goes quiet. A running AudioContext keeps an audio
   * thread and its render quantum alive even with nothing playing, which shows
   * up as a steady trickle of CPU on a machine that is supposed to be idle.
   *
   * The delay covers the tail of whatever just played — suspending mid-sound
   * would clip it — and `play()` resumes the context on its own.
   */
  idle() {
    if (!this.ctx || this.ctx.state !== "running" || this.idleTimer != null) return;
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      void this.ctx?.suspend();
    }, 1500);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(0.2, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
  }

  /** Plays a sound. `pan` places it in stereo: -1 left … 1 right — the desktop
   * Miku's little sounds come from where she stands. 0 is the island, centre. */
  play(name: SoundName | string, pan = 0) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const master = this.master;
    const buf = this.buffers.get(name);
    if (!ctx || !master || !buf) return;
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (ctx.state === "suspended") void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * (isSpoken(name) ? 0.005 : 0.02);
    const gain = ctx.createGain();
    src.connect(gain);
    let out: AudioNode = gain;
    if (pan !== 0 && typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(panner);
      out = panner;
    }
    out.connect(master);
    const voice = { src, gain };
    let voices = this.playing.get(name);
    if (!voices) this.playing.set(name, (voices = new Set()));
    voices.add(voice);
    src.onended = () => {
      voices.delete(voice);
      gain.disconnect();
    };
    src.start();
  }

  /**
   * A notice from `slot`: the sound the user picked for it, or `usual` — the
   * one Miku has always played there — when nothing was picked.
   */
  notify(slot: NotifySlot, usual: SoundName | string) {
    this.play(notifySound(this.notifyChoices[slot], slot, usual, (name) => this.buffers.has(name)));
  }

  /** Fades every playing copy of `name` to silence over `seconds`, then stops it. */
  fadeOut(name: string, seconds: number) {
    const ctx = this.ctx;
    const voices = this.playing.get(name);
    if (!ctx || !voices) return;
    const t = ctx.currentTime;
    for (const { src, gain } of voices) {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + seconds);
      try {
        src.stop(t + seconds);
      } catch {
        /* already stopped */
      }
    }
  }
}

export const Sound = new SoundEngine();

/** The sound a notice slot plays (`""` plays nothing). Pure, for the tests. */
export function notifySound(
  choice: string | undefined,
  slot: string,
  usual: string,
  has: (name: string) => boolean,
): string {
  if (choice === "none") return "";
  if (choice === "file") return has(slot) ? slot : usual;
  if (choice && (SOUND_NAMES as readonly string[]).includes(choice)) return choice;
  return usual;
}
