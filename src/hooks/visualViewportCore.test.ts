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
console.log("ALL PASS");
