// The hour, worn as light. The ambience — the island's weather, the hub band's
// glow — takes a tint from the clock: dawn warms it, day leaves it alone, dusk
// goes violet, night cools and dims. Pure clock math: no network, no location,
// nothing to configure.

/** A tint as 0…1 RGB plus how strongly to wear it, 0…1. */
export interface SkyTint {
  rgb: readonly [number, number, number];
  strength: number;
}

const DAY: SkyTint = { rgb: [1, 1, 1], strength: 0 };

/** Dawn 5–8 warms, day 8–17 is neutral, dusk 17–21 goes violet, night cools. */
export function skyTint(hour: number): SkyTint {
  if (hour >= 5 && hour < 8) return { rgb: [1, 0.78, 0.62], strength: 0.5 }; // dawn peach
  if (hour >= 8 && hour < 17) return DAY;                                    // day: none
  if (hour >= 17 && hour < 21) return { rgb: [0.82, 0.72, 1], strength: 0.4 }; // dusk violet
  return { rgb: [0.62, 0.74, 1], strength: 0.45 };                           // night cool
}

/** "r,g,b" of a tint, for rgba() strings. */
export function tintChannels(t: SkyTint): string {
  return t.rgb.map((v) => Math.round(v * 255)).join(",");
}
