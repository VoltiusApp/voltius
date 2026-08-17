import { test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { useRipple } from "./useRipple";

function RippleButton() {
  const { createRipple, rippleEls } = useRipple();
  return <button onPointerDown={createRipple}>{rippleEls}press</button>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * A press registers document listeners and timers that outlive the event. Left
 * behind by an unmount they fire against a torn-down document — which is how a
 * menu that closes mid-press takes the page down with it.
 */
test("unmounting mid-press takes the listeners and timers with it", () => {
  vi.useFakeTimers();
  const addSpy = vi.spyOn(document, "addEventListener");
  const removeSpy = vi.spyOn(document, "removeEventListener");

  const view = render(<RippleButton />);
  fireEvent.pointerDown(view.getByText("press"), { clientX: 1, clientY: 1 });

  const added = addSpy.mock.calls.filter(([type]) => type === "pointerup" || type === "pointercancel");
  expect(added).toHaveLength(2);

  view.unmount();

  const removed = removeSpy.mock.calls.filter(([type]) => type === "pointerup" || type === "pointercancel");
  expect(removed).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});

test("a completed press cleans up after itself", () => {
  vi.useFakeTimers();
  const view = render(<RippleButton />);

  fireEvent.pointerDown(view.getByText("press"), { clientX: 1, clientY: 1 });
  fireEvent.pointerUp(document);
  act(() => { vi.advanceTimersByTime(1000); });

  expect(vi.getTimerCount()).toBe(0);
  expect(view.container.querySelectorAll("span.ripple")).toHaveLength(0);
});
