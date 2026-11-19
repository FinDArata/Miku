// One canvas helper shared by every per-frame painter.

/** The 2d context of a canvas, remembered: calling getContext every frame
 * re-bound the same context for nothing. */
const CONTEXTS = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  let x: CanvasRenderingContext2D | null = CONTEXTS.get(c) ?? null;
  if (!x) {
    x = c.getContext("2d");
    if (x) CONTEXTS.set(c, x);
  }
  return x;
}
