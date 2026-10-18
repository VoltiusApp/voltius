import {
  linesFromPixelDelta,
  fontSizeFromPinch,
  touchDistance,
} from "./mobileTerminalGesturesCore.ts";
import { test } from "vitest";

test("mobileTerminalGestures", async () => {
function eq<T>(a: T, b: T, msg: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); }

// linesFromPixelDelta: accumulates a fractional carry.
eq(linesFromPixelDelta(8, 16, 0), { lines: 0, carry: 0.5 }, "half a cell carries");
eq(linesFromPixelDelta(8, 16, 0.5), { lines: 1, carry: 0 }, "carry completes a line");
eq(linesFromPixelDelta(-24, 16, 0), { lines: -1, carry: -0.5 }, "negative truncates toward zero");

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
