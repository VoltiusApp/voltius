import { computeKeyboardLayout, type ViewportInput } from "./visualViewportCore.ts";
import { test } from "vitest";

test("visualViewportCore", async () => {
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
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
// Android native resize (SystemInsets.kt): the WebView already ends at the keyboard top, so
// visual == layout height, yet the keyboard is open (nativeIme > 0) — no inset left to apply.
{
  const r = computeKeyboardLayout({ layoutHeight: 555, visualHeight: 555, visualOffsetTop: 0, nativeIme: 336 });
  assertEqual(r.keyboardVisible, true, "native ime: visible");
  assertEqual(r.bottomInset, 0, "native ime: no double inset");
  assertEqual(r.usableHeight, 555, "native ime: usable = resized height");
}
{
  const r = computeKeyboardLayout({ layoutHeight: 915, visualHeight: 915, visualOffsetTop: 0, nativeIme: 0 });
  assertEqual(r.keyboardVisible, false, "native ime 0: closed");
}
});
