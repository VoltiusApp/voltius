const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Convert a pixel delta into whole scroll lines, carrying the sub-cell remainder. */
export function linesFromPixelDelta(
  dy: number,
  cellHeight: number,
  carry: number,
): { lines: number; carry: number } {
  const total = carry + dy / cellHeight;
  const lines = Math.trunc(total);
  return { lines, carry: total - lines };
}

/** Distance between the first two touch points of a gesture. */
export function touchDistance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Terminal font size for a pinch that started at `startDist` with `startSize`.
 * Scaling the size by the raw distance ratio makes the text track the fingers,
 * and rounding to whole pixels keeps xterm off fractional cell metrics.
 */
export function fontSizeFromPinch(
  startSize: number,
  startDist: number,
  dist: number,
  min: number,
  max: number,
): number {
  if (startDist <= 0) return startSize;
  return clamp(Math.round(startSize * (dist / startDist)), min, max);
}

/** px/ms a released scroll must reach to fling, and the speed where a fling stops. */
export const FLING_MIN_V = 0.3;
export const FLING_STOP_V = 0.02;
const FLING_TAU_MS = 325;

/** One animation frame of a fling: the pixels to move and the decayed velocity (exponential, like iOS). */
export function flingStep(v: number, dtMs: number): { dy: number; v: number } {
  const next = v * Math.exp(-dtMs / FLING_TAU_MS);
  return { dy: (v - next) * FLING_TAU_MS, v: Math.abs(next) < FLING_STOP_V ? 0 : next };
}

/** Arrow presses a sideways drag of `dx` px is worth in a full-screen app (+ = Right): the first at a
 *  quarter of the width, then one per half width, since less pans half a screen per arrow. */
export function panArrows(dx: number, width: number): number {
  if (width <= 0) return 0;
  return -Math.sign(dx) * Math.floor((Math.abs(dx) + width / 4) / (width / 2));
}

export function touchCentroidX(a: { clientX: number }, b: { clientX: number }): number {
  return (a.clientX + b.clientX) / 2;
}

export const TWO_FINGER_SLOP_PX = 16;
export type TwoFingerIntent = "pinch" | "pan" | null;

/** Two fingers moving sideways together pan; fingers spreading or closing pinch. Null until one
 *  passes the slop. */
export function twoFingerIntent(distDelta: number, centroidDx: number): TwoFingerIntent {
  const spread = Math.abs(distDelta), slide = Math.abs(centroidDx);
  if (spread < TWO_FINGER_SLOP_PX && slide < TWO_FINGER_SLOP_PX) return null;
  return slide > spread * 2 ? "pan" : "pinch";
}
