import { computeKeyboardLayout, type ViewportInput } from "./visualViewportCore.ts";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
  console.log(`PASS ${msg}`);
}

// keyboard closed: visual == layout height, no inset
{
  const i: ViewportInput = { layoutHeight: 800, visualHeight: 800, visualOffsetTop: 0 };
  const r = computeKeyboardLayout(i);
  assertEqual(r.keyboardVisible, false, "closed: not visible");
  assertEqual(r.bottomInset, 0, "closed: no inset");
  assertEqual(r.usableHeight, 800, "closed: full height");
}
// keyboard open: visual shrinks; inset = layout - visual - offset
{
  const i: ViewportInput = { layoutHeight: 800, visualHeight: 460, visualOffsetTop: 0 };
  const r = computeKeyboardLayout(i);
  assertEqual(r.keyboardVisible, true, "open: visible");
  assertEqual(r.bottomInset, 340, "open: inset = 340");
  assertEqual(r.usableHeight, 460, "open: usable shrinks");
}
// noise below threshold (toolbar wobble) is not a keyboard
{
  const i: ViewportInput = { layoutHeight: 800, visualHeight: 790, visualOffsetTop: 0 };
  const r = computeKeyboardLayout(i);
  assertEqual(r.keyboardVisible, false, "10px wobble ignored");
}
// offsetTop is surfaced so position:fixed sheets can track the visual viewport
{
  const i: ViewportInput = { layoutHeight: 800, visualHeight: 460, visualOffsetTop: 0 };
  assertEqual(computeKeyboardLayout(i).offsetTop, 0, "no scroll: offsetTop 0");
}
// device-observed (OnePlus c351ff7f): focusing an input scrolls the layout viewport
// instead of producing a bottom inset, so offsetTop is large and bottomInset tiny.
// usableHeight must still be the visual height; offsetTop must be surfaced for positioning.
{
  const i: ViewportInput = { layoutHeight: 804, visualHeight: 476, visualOffsetTop: 309 };
  const r = computeKeyboardLayout(i);
  assertEqual(r.offsetTop, 309, "scroll case: offsetTop surfaced");
  assertEqual(r.usableHeight, 476, "scroll case: usable = visual height");
}
console.log("ALL PASS");
