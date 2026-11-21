// What Miku says when three pokes make her sulk: the line in her bubble
// (views/deck.ts) and the same line spoken (voice/poke-*.wav, rendered by
// scripts/voice-cues.mjs). One table, so the voice always matches the words.

import { N_ } from "../i18n/i18n";

export const POKE_LINES = [
  { text: N_("Hey! Stop poking me!"), voice: "poke-stop" },
  { text: N_("Hmph!"), voice: "poke-hmph" },
  { text: N_("That's enough!"), voice: "poke-enough" },
  { text: N_("I'm not talking to you."), voice: "poke-silent" },
  { text: N_("Ow! Rude!"), voice: "poke-rude" },
  { text: N_("Let me work!"), voice: "poke-work" },
] as const;

export type PokeVoice = (typeof POKE_LINES)[number]["voice"];
