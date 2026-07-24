import { wheelToRows } from "./terminalWheelCore.ts";
import { test } from "vitest";

test("terminalWheelCore", async () => {
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) { console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); throw new Error(msg); }
}

// Pixel mode (touchpads / most browsers): one cell-height down → one row down, no carry.
assertEqual(wheelToRows({ deltaY: 17, deltaMode: 0, cellHeight: 17, viewportRows: 24, carry: 0 }), { rows: 1, carry: 0 }, "one cell down");
assertEqual(wheelToRows({ deltaY: -17, deltaMode: 0, cellHeight: 17, viewportRows: 24, carry: 0 }), { rows: -1, carry: 0 }, "one cell up");

// Touchpad: many sub-cell pixel deltas accumulate across calls until they cross a row.
const a = wheelToRows({ deltaY: 6, deltaMode: 0, cellHeight: 17, viewportRows: 24, carry: 0 });
assertEqual(a, { rows: 0, carry: 6 }, "sub-row 1 accumulates");
const b = wheelToRows({ deltaY: 6, deltaMode: 0, cellHeight: 17, viewportRows: 24, carry: a.carry });
assertEqual(b, { rows: 0, carry: 12 }, "sub-row 2 accumulates");
const c = wheelToRows({ deltaY: 6, deltaMode: 0, cellHeight: 17, viewportRows: 24, carry: b.carry });
assertEqual(c, { rows: 1, carry: 1 }, "sub-row 3 crosses one row, remainder carried");

// Reversing direction nets against the carried remainder rather than double-counting.
assertEqual(wheelToRows({ deltaY: -7, deltaMode: 0, cellHeight: 17, viewportRows: 24, carry: 10 }), { rows: 0, carry: 3 }, "reversal nets carry");

// Line mode (deltaMode 1): deltaY is already in rows, scaled via cellHeight.
assertEqual(wheelToRows({ deltaY: 3, deltaMode: 1, cellHeight: 17, viewportRows: 24, carry: 0 }), { rows: 3, carry: 0 }, "line mode 3 rows");

// Page mode (deltaMode 2): a page is viewportRows rows.
assertEqual(wheelToRows({ deltaY: 1, deltaMode: 2, cellHeight: 17, viewportRows: 24, carry: 0 }), { rows: 24, carry: 0 }, "page mode one page down");

// Degenerate cell height must not divide-by-zero or emit movement.
assertEqual(wheelToRows({ deltaY: 100, deltaMode: 0, cellHeight: 0, viewportRows: 24, carry: 0 }), { rows: 0, carry: 0 }, "zero cell height is inert");

// Zero delta is inert but preserves any existing carry.
assertEqual(wheelToRows({ deltaY: 0, deltaMode: 0, cellHeight: 17, viewportRows: 24, carry: 5 }), { rows: 0, carry: 5 }, "zero delta preserves carry");

// maxRows clamps a fling to a page and drops the excess (carry reset) so the PTY
// isn't flooded with hundreds of arrows from one gesture.
assertEqual(wheelToRows({ deltaY: 5000, deltaMode: 0, cellHeight: 17, viewportRows: 24, carry: 0, maxRows: 24 }), { rows: 24, carry: 0 }, "clamp down to a page");
assertEqual(wheelToRows({ deltaY: -5000, deltaMode: 0, cellHeight: 17, viewportRows: 24, carry: 0, maxRows: 24 }), { rows: -24, carry: 0 }, "clamp up to a page");
assertEqual(wheelToRows({ deltaY: 34, deltaMode: 0, cellHeight: 17, viewportRows: 24, carry: 0, maxRows: 24 }), { rows: 2, carry: 0 }, "within clamp unaffected");
});
