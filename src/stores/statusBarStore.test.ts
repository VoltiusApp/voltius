import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStatusBarStore, useStatusBarMounted } from "@/stores/statusBarStore";

afterEach(() => {
  useStatusBarStore.setState({ mountedCount: 0 });
});

describe("statusBarStore", () => {
  it("starts unmounted", () => {
    expect(useStatusBarStore.getState().mountedCount).toBe(0);
    expect(renderHook(() => useStatusBarMounted()).result.current).toBe(false);
  });

  it("reports mounted once any bar increments, and unmounted once every increment is matched", () => {
    const { increment, decrement } = useStatusBarStore.getState();
    act(() => increment());
    expect(renderHook(() => useStatusBarMounted()).result.current).toBe(true);

    act(() => increment());
    expect(useStatusBarStore.getState().mountedCount).toBe(2);
    act(() => decrement());
    expect(renderHook(() => useStatusBarMounted()).result.current).toBe(true);

    act(() => decrement());
    expect(renderHook(() => useStatusBarMounted()).result.current).toBe(false);
  });

  it("never goes negative on an unmatched decrement", () => {
    act(() => useStatusBarStore.getState().decrement());
    expect(useStatusBarStore.getState().mountedCount).toBe(0);
  });

  it("several mounts and unmounts in one frame settle on the net count", () => {
    const { increment, decrement } = useStatusBarStore.getState();
    act(() => {
      increment();
      increment();
      decrement();
      increment();
      decrement();
    });
    expect(useStatusBarStore.getState().mountedCount).toBe(1);
    expect(renderHook(() => useStatusBarMounted()).result.current).toBe(true);
  });
});
