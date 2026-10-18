export interface CellMetrics {
  /** `.xterm-screen` bounding-rect origin in client coords. */
  left: number;
  top: number;
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
  /** Absolute buffer line at the top of the viewport (buffer.active.viewportY). */
  viewportTop: number;
}

export interface Cell {
  col: number;
  /** Absolute buffer line (viewportTop + row-in-view). */
  line: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Map a client (x, y) point to an absolute buffer cell, clamped to the grid. */
export function cellFromPoint(m: CellMetrics, x: number, y: number): Cell {
  const col = clamp(Math.floor((x - m.left) / m.cellWidth), 0, m.cols - 1);
  const row = clamp(Math.floor((y - m.top) / m.cellHeight), 0, m.rows - 1);
  return { col, line: m.viewportTop + row };
}

const isSpace = (ch: string | undefined) => !ch || /\s/.test(ch);

/** A cell is "blank" when it is whitespace or past the end of the rendered line text. */
export function isBlankCell(lineText: string, col: number): boolean {
  return isSpace(lineText[col]);
}

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
