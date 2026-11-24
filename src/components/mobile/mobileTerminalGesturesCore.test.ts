import {
  linesFromPixelDelta,
  fontSizeFromPinch,
  touchDistance,
  flingStep,
  panArrows,
  twoFingerIntent,
  touchCentroidX,
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

test("flingStep decays and stops", () => {
  const a = flingStep(1, 16);
  if (!(a.dy > 15 && a.dy < 16 && a.v < 1 && a.v > 0.9)) throw new Error(`first frame ${JSON.stringify(a)}`);
  let v = 1, travelled = 0, frames = 0;
  while (v !== 0 && frames < 1000) { const s = flingStep(v, 16); travelled += s.dy; v = s.v; frames += 1; }
  if (v !== 0 || frames >= 1000) throw new Error("fling never stopped");
  if (travelled > 325 || travelled < 300) throw new Error(`travel ${travelled}`);
  const up = flingStep(-1, 16);
  if (!(up.dy < 0 && up.v < 0)) throw new Error("upward fling keeps its sign");
});

test("panArrows: first arrow at a quarter width, then one per half width, finger left = Right", () => {
  const eq = (got: number, want: number, msg: string) => { if (got !== want) throw new Error(`${msg}: got ${got} want ${want}`); };
  eq(panArrows(-99, 400), 0, "short drag sends nothing");
  eq(panArrows(-100, 400), 1, "quarter width to the left is one Right");
  eq(panArrows(100, 400), -1, "quarter width to the right is one Left");
  eq(panArrows(-299, 400), 1, "still one before three quarters");
  eq(panArrows(-300, 400), 2, "three quarters is two");
  eq(panArrows(-300, 0), 0, "no width, no arrows");
});

test("twoFingerIntent: a sideways slide pans, a spread pinches, small moves wait", () => {
  const eq = (got: unknown, want: unknown, msg: string) => { if (got !== want) throw new Error(`${msg}: got ${String(got)} want ${String(want)}`); };
  eq(twoFingerIntent(3, 10), null, "inside the slop");
  eq(twoFingerIntent(4, -40), "pan", "fingers slide together");
  eq(twoFingerIntent(60, 5), "pinch", "fingers spread");
  eq(twoFingerIntent(-30, 40), "pinch", "slide with a big spread change is a pinch");
  eq(touchCentroidX({ clientX: 100 }, { clientX: 300 }), 200, "centroid");
});
