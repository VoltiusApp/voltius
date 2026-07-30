import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { usePendingKills } from "./usePendingKills";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("usePendingKills", () => {
  it("commits after the window elapses and clears pending", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => usePendingKills(onCommit, 5000));
    act(() => result.current.start("s1"));
    expect(result.current.pending.has("s1")).toBe(true);
    act(() => vi.advanceTimersByTime(5000));
    expect(onCommit).toHaveBeenCalledWith("s1");
    expect(result.current.pending.has("s1")).toBe(false);
  });

  it("cancel before the window prevents the commit", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => usePendingKills(onCommit, 5000));
    act(() => result.current.start("s1"));
    act(() => result.current.cancel("s1"));
    act(() => vi.advanceTimersByTime(5000));
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.pending.has("s1")).toBe(false);
  });

  it("tracks multiple sessions independently", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => usePendingKills(onCommit, 5000));
    act(() => { result.current.start("a"); result.current.start("b"); });
    act(() => result.current.cancel("a"));
    act(() => vi.advanceTimersByTime(5000));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("b");
  });
});
