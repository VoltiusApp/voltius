// @vitest-environment jsdom
import { test, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCloseWhenGone } from "./useCloseWhenGone";

function mount(id: string | null, present: boolean) {
  const close = vi.fn();
  const hook = renderHook(
    ({ id, present }) => useCloseWhenGone(id, present, close),
    { initialProps: { id, present } },
  );
  return { close, rerender: (next: { id: string | null; present: boolean }) => hook.rerender(next) };
}

test("closes once a shown object leaves the list", () => {
  const { close, rerender } = mount("a", true);
  rerender({ id: "a", present: false });
  expect(close).toHaveBeenCalledTimes(1);
  rerender({ id: "a", present: false });
  expect(close).toHaveBeenCalledTimes(1);
});

test("leaves an object alone until it has been seen in the list", () => {
  const { close, rerender } = mount("new-id", false);
  rerender({ id: "new-id", present: false });
  rerender({ id: "new-id", present: true });
  expect(close).not.toHaveBeenCalled();
});

test("switching to another object does not close for the previous one", () => {
  const { close, rerender } = mount("a", true);
  rerender({ id: "b", present: false });
  rerender({ id: null, present: false });
  expect(close).not.toHaveBeenCalled();
});
