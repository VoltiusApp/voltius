// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { startInternalDragGesture } from "./internalDrag";

const selectStartPrevented = () => {
  const ev = new Event("selectstart", { cancelable: true });
  document.body.dispatchEvent(ev);
  return ev.defaultPrevented;
};

const start = () =>
  startInternalDragGesture({ side: "left", files: [], startX: 0, startY: 0, onDrop: () => {} });

describe("startInternalDragGesture text selection", () => {
  test("blocks text selection for the whole gesture", () => {
    start();
    expect(selectStartPrevented()).toBe(true);
    window.dispatchEvent(new Event("pointerup"));
    expect(selectStartPrevented()).toBe(false);
  });

  test("Escape releases the selection block", () => {
    start();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(selectStartPrevented()).toBe(false);
  });
});
