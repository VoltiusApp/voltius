import { afterEach, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCopiedFlash } from "./useCopiedFlash";

afterEach(() => { vi.useRealTimers(); });

test("resets after duration", () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useCopiedFlash(1000));
  act(() => { result.current.flash(); });
  expect(result.current.copied).toBe(true);
  act(() => { vi.advanceTimersByTime(999); });
  expect(result.current.copied).toBe(true);
  act(() => { vi.advanceTimersByTime(1); });
  expect(result.current.copied).toBe(false);
});

test("re-flash restarts the timer", () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useCopiedFlash(1000));
  act(() => { result.current.flash(); });
  act(() => { vi.advanceTimersByTime(700); });
  act(() => { result.current.flash(); });
  act(() => { vi.advanceTimersByTime(700); });
  expect(result.current.copied).toBe(true);
  act(() => { vi.advanceTimersByTime(300); });
  expect(result.current.copied).toBe(false);
});

test("persist never resets", () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useCopiedFlash(1000));
  act(() => { result.current.flash(true); });
  act(() => { vi.advanceTimersByTime(10000); });
  expect(result.current.copied).toBe(true);
});

test("no timer left pending after unmount", () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() => useCopiedFlash(1000));
  act(() => { result.current.flash(); });
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
