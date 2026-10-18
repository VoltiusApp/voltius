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
