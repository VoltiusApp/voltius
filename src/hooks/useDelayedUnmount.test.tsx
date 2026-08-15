import { test, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDelayedUnmount } from "./useDelayedUnmount";

test("stays mounted for the exit duration, then unmounts", async () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ open }) => useDelayedUnmount(open, 120), { initialProps: { open: true } });
  expect(result.current).toBe(true);
  rerender({ open: false });
  expect(result.current).toBe(true);
  act(() => { vi.advanceTimersByTime(119); });
  expect(result.current).toBe(true);
  act(() => { vi.advanceTimersByTime(2); });
  expect(result.current).toBe(false);
  vi.useRealTimers();
});

test("re-opening during the exit cancels the unmount", async () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ open }) => useDelayedUnmount(open, 120), { initialProps: { open: true } });
  rerender({ open: false });
  act(() => { vi.advanceTimersByTime(60); });
  rerender({ open: true });
  act(() => { vi.advanceTimersByTime(200); });
  expect(result.current).toBe(true);
  vi.useRealTimers();
});
