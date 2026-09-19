import { describe, it, expect, afterEach } from "vitest";
import { useEffect } from "react";
import { renderHook, render, cleanup, act } from "@testing-library/react";
import { useStatusBarStore, useStatusBarMounted } from "@/stores/statusBarStore";

afterEach(() => {
  cleanup();
  useStatusBarStore.setState({ mountedCount: 0 });
});

// Mirrors TerminalStatusBar's registration effect: mounted-but-not-visible never registers.
function RegisteringBar({ visible }: { visible: boolean }) {
  useEffect(() => {
    if (!visible) return;
    const { increment, decrement } = useStatusBarStore.getState();
    increment();
    return decrement;
  }, [visible]);
  return null;
}

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

  it("a bar that is mounted but not visible never registers", () => {
    render(<RegisteringBar visible={false} />);
    expect(useStatusBarStore.getState().mountedCount).toBe(0);
    expect(renderHook(() => useStatusBarMounted()).result.current).toBe(false);
  });

  it("registers once it turns visible in place, and unregisters once it turns hidden again, without remounting", () => {
    const { rerender } = render(<RegisteringBar visible={false} />);
    expect(useStatusBarStore.getState().mountedCount).toBe(0);

    rerender(<RegisteringBar visible={true} />);
    expect(useStatusBarStore.getState().mountedCount).toBe(1);

    rerender(<RegisteringBar visible={false} />);
    expect(useStatusBarStore.getState().mountedCount).toBe(0);
  });
});
