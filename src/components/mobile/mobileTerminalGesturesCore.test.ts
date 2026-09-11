import {
  cellFromPoint,
  wordRangeAt,
  isBlankCell,
  linesFromPixelDelta,
  extendSelection,
  selectionLength,
  cellPixel,
  fontSizeFromPinch,
  touchDistance,
  type CellMetrics,
} from "./mobileTerminalGesturesCore.ts";
import { test } from "vitest";

test("mobileTerminalGestures", async () => {
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function eq<T>(a: T, b: T, msg: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); }

const m: CellMetrics = { left: 10, top: 20, cellWidth: 8, cellHeight: 16, cols: 80, rows: 24, viewportTop: 100 };

// cellFromPoint: maps client px to absolute buffer cell.
eq(cellFromPoint(m, 10, 20), { col: 0, line: 100 }, "origin maps to col0/viewportTop");
eq(cellFromPoint(m, 10 + 8 * 3 + 2, 20 + 16 * 2 + 1), { col: 3, line: 102 }, "mid maps via floor");
// Clamped inside the grid.
eq(cellFromPoint(m, -100, -100), { col: 0, line: 100 }, "clamps low");
eq(cellFromPoint(m, 99999, 99999), { col: 79, line: 123 }, "clamps high to cols-1 / last visible line");

// wordRangeAt: maximal run of non-whitespace around col.
eq(wordRangeAt("ls -la /etc", 0), { startCol: 0, len: 2 }, "word at start");
eq(wordRangeAt("ls -la /etc", 4), { startCol: 3, len: 3 }, "word -la");
eq(wordRangeAt("ls -la /etc", 8), { startCol: 7, len: 4 }, "word /etc");
// On whitespace → zero-length at that col.
eq(wordRangeAt("ls -la", 2), { startCol: 2, len: 0 }, "whitespace → empty word");

// isBlankCell.
assert(isBlankCell("ls", 5), "past end is blank");
assert(isBlankCell("a b", 1), "space is blank");
assert(!isBlankCell("a b", 0), "letter is not blank");

// linesFromPixelDelta: accumulates a fractional carry.
eq(linesFromPixelDelta(8, 16, 0), { lines: 0, carry: 0.5 }, "half a cell carries");
eq(linesFromPixelDelta(8, 16, 0.5), { lines: 1, carry: 0 }, "carry completes a line");
eq(linesFromPixelDelta(-24, 16, 0), { lines: -1, carry: -0.5 }, "negative truncates toward zero");

// extendSelection: char-precise, same line or crossing lines.
eq(
  extendSelection({ col: 3, line: 100 }, { col: 6, line: 100 }, { col: 9, line: 100 }),
  { start: { col: 3, line: 100 }, end: { col: 9, line: 100 } },
  "same line extends to focus",
);
eq(
  extendSelection({ col: 3, line: 100 }, { col: 6, line: 100 }, { col: 1, line: 100 }),
  { start: { col: 1, line: 100 }, end: { col: 6, line: 100 } },
  "same line extends left of anchor",
);
eq(
  extendSelection({ col: 3, line: 100 }, { col: 6, line: 100 }, { col: 2, line: 104 }),
  { start: { col: 3, line: 100 }, end: { col: 2, line: 104 } },
  "cross line downward stays char-precise",
);
eq(
  extendSelection({ col: 3, line: 100 }, { col: 6, line: 100 }, { col: 2, line: 97 }),
  { start: { col: 2, line: 97 }, end: { col: 6, line: 100 } },
  "cross line upward stays char-precise",
);
eq(
  extendSelection({ col: 3, line: 100 }, { col: 3, line: 100 }, { col: 0, line: 100 }),
  { start: { col: 0, line: 100 }, end: { col: 3, line: 100 } },
  "two-point range (handle drag) — focus before fixed",
);
eq(
  extendSelection({ col: 3, line: 100 }, { col: 3, line: 100 }, { col: 1, line: 102 }),
  { start: { col: 3, line: 100 }, end: { col: 1, line: 102 } },
  "two-point range (handle drag) — focus on a later line",
);

// selectionLength: char count term.select(col, row, length) needs, wrapping at `cols`.
eq(selectionLength({ col: 3, line: 100 }, { col: 9, line: 100 }, 80), 7, "same line inclusive count");
eq(selectionLength({ col: 3, line: 100 }, { col: 2, line: 104 }, 80), 4 * 80 - 1 + 1, "wraps 4 full lines via cols");
eq(selectionLength({ col: 0, line: 100 }, { col: 0, line: 100 }, 80), 1, "single cell");

// cellPixel: left edge (colOffset 0) vs right edge (colOffset 1) of a cell, in client coords.
eq(cellPixel(m, { col: 3, line: 102 }, 0), { x: 10 + 3 * 8, y: 20 + 2 * 16 }, "left edge");
eq(cellPixel(m, { col: 3, line: 102 }, 1), { x: 10 + 4 * 8, y: 20 + 2 * 16 }, "right edge");

// touchDistance / fontSizeFromPinch: two fingers scale the terminal font size.
eq(touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 }), 5, "euclidean distance");
eq(fontSizeFromPinch(14, 100, 200, 8, 32), 28, "spread doubles the size");
eq(fontSizeFromPinch(14, 100, 50, 8, 32), 8, "pinch in clamps to min");
eq(fontSizeFromPinch(14, 100, 100, 8, 32), 14, "no movement keeps the size");
eq(fontSizeFromPinch(14, 100, 1000, 8, 32), 32, "runaway spread clamps to max");
eq(fontSizeFromPinch(14, 100, 110, 8, 32), 15, "small spread rounds to whole px");
// A zero start distance (both fingers on one point) must not divide by zero.
eq(fontSizeFromPinch(14, 0, 50, 8, 32), 14, "zero start distance is a no-op");
});
