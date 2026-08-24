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

/** Maximal run of non-whitespace around `col`. Zero-length when `col` is whitespace/past end. */
export function wordRangeAt(lineText: string, col: number): { startCol: number; len: number } {
  if (isSpace(lineText[col])) return { startCol: col, len: 0 };
  let start = col;
  while (start > 0 && !isSpace(lineText[start - 1])) start -= 1;
  let end = col;
  while (end < lineText.length - 1 && !isSpace(lineText[end + 1])) end += 1;
  return { startCol: start, len: end - start + 1 };
}

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

export type Selection =
  | { kind: "line"; startCol: number; line: number; len: number }
  | { kind: "lines"; start: number; end: number };

/**
 * Extend a selection seeded by the word [anchorStart..anchorEnd] (same line) out to `focus`.
 * Same line → character-precise range; crossing lines → whole-line range (xterm public-API limit).
 */
export function extendSelection(anchorStart: Cell, anchorEnd: Cell, focus: Cell): Selection {
  if (focus.line === anchorStart.line && anchorStart.line === anchorEnd.line) {
    const lo = Math.min(anchorStart.col, focus.col);
    const hi = Math.max(anchorEnd.col, focus.col);
    return { kind: "line", startCol: lo, line: anchorStart.line, len: hi - lo + 1 };
  }
  const start = Math.min(anchorStart.line, focus.line);
  const end = Math.max(anchorEnd.line, focus.line);
  return { kind: "lines", start, end };
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
