/** Pure wheel-delta → terminal-row math for alternate-screen scroll translation.
 *  No DOM/xterm; node-testable. Full-screen apps (nano/less/vim) run in the
 *  alternate buffer where xterm has no scrollback to move, so a wheel/touchpad
 *  scroll is translated into Up/Down arrow presses. This converts a WheelEvent's
 *  delta into a signed row count, carrying the sub-row remainder across events so
 *  touchpads (which emit many tiny pixel deltas) still scroll smoothly. */
export interface WheelToRowsInput {
  /** WheelEvent.deltaY. */
  deltaY: number;
  /** WheelEvent.deltaMode: 0 = pixels, 1 = lines, 2 = pages. */
  deltaMode: number;
  /** Rendered height of one terminal row, in CSS pixels. */
  cellHeight: number;
  /** Rows in the viewport (a "page" in deltaMode 2). */
  viewportRows: number;
  /** Sub-row pixel remainder carried from the previous call. */
  carry: number;
  /** Cap on rows emitted from a single event (a fling shouldn't flood the PTY).
   *  When the movement exceeds it, the result is clamped and the remainder dropped. */
  maxRows?: number;
}

export interface WheelToRowsResult {
  /** Rows to move: negative = up, positive = down. */
  rows: number;
  /** Sub-row pixel remainder to feed into the next call. */
  carry: number;
}

export function wheelToRows({ deltaY, deltaMode, cellHeight, viewportRows, carry, maxRows }: WheelToRowsInput): WheelToRowsResult {
  if (cellHeight <= 0) return { rows: 0, carry: 0 };

  // Normalize the delta to pixels regardless of the browser's reporting mode.
  let pixels: number;
  if (deltaMode === 1) pixels = deltaY * cellHeight;          // lines
  else if (deltaMode === 2) pixels = deltaY * viewportRows * cellHeight; // pages
  else pixels = deltaY;                                       // pixels

  const total = carry + pixels;
  const rows = Math.trunc(total / cellHeight);
  if (maxRows !== undefined && Math.abs(rows) > maxRows) {
    return { rows: rows < 0 ? -maxRows : maxRows, carry: 0 };
  }
  return { rows, carry: total - rows * cellHeight };
}
