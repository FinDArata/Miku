// Pure rules for reacting to the system's music. Rust captures the default
// render endpoint (WASAPI loopback on Windows, a PulseAudio monitor on Linux)
// and reports one rms + bass frame ~30 times a second; these decide what the
// dance does with them. No clock, no randomness: deterministic and testable.

/** Dance energy from a normalized rms (0…1): quiet stays still, loud caps out. */
export function musicEnergy(rms: number): number {
  return Math.min(1, Math.max(0, rms * 1.6));
}

/** Voice loudness from the mic bands (each 0…1): a soft RMS over them, leaning
 * nowhere in particular — speech fills all nine bands. 0…1. */
export function voiceLevel(bands: readonly number[]): number {
  if (!bands.length) return 0;
  let sum = 0;
  for (const b of bands) sum += b * b;
  return Math.min(1, Math.sqrt(sum / bands.length) * 1.4);
}

/** rms and bass from the band levels (music.rs sends the same shape the pill's
 * dots use): rms over all of them, bass over the two lowest, where the beat
 * lives. */
export function bandStats(bands: readonly number[]): { rms: number; bass: number } {
  if (!bands.length) return { rms: 0, bass: 0 };
  let all = 0;
  let low = 0;
  for (let i = 0; i < bands.length; i++) {
    all += bands[i] * bands[i];
    if (i < 2) low += bands[i] * bands[i];
  }
  return { rms: Math.sqrt(all / bands.length), bass: Math.sqrt(low / Math.min(2, bands.length)) };
}

/**
 * A tiny bass-onset detector. Armed by frames near its own running average, it
 * fires once when the bass jumps well clear of that average — one beat, not
 * one per loud frame while the drop sustains.
 */
export class BeatTracker {
  private avg = 0;
  private armed = true;

  /** Feeds one bass-band frame and says whether a beat just landed. */
  push(bass: number): boolean {
    this.avg = this.avg * 0.88 + bass * 0.12;
    if (this.armed && bass > 0.1 && bass > this.avg * 1.45) {
      this.armed = false;
      return true;
    }
    if (bass <= this.avg * 1.1) this.armed = true;
    return false;
  }
}
