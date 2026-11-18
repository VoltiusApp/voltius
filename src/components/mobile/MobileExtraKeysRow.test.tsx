import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { useSessionStore } from "@/stores/sessionStore";
import { KEY_HOLD_MS } from "./extraKeysCore";

const sendSpecialKey = vi.fn();
vi.mock("@/services/terminalInput", () => ({ sendSpecialKey: (...a: unknown[]) => sendSpecialKey(...a) }));
vi.mock("@/lib/haptics", () => ({ haptic: () => true }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });
const popup = () => document.body.querySelector("[data-mobile-key-alt-popup]");

beforeEach(() => {
  vi.useFakeTimers();
  sendSpecialKey.mockClear();
  useSessionStore.setState({ activeSessionId: "s1" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function tabKey() {
  const { default: Row } = await import("./MobileExtraKeysRow");
  const { container } = render(<Row />);
  return container.querySelector<HTMLElement>('[data-mobile-key="Tab"]')!;
}

describe("MobileExtraKeysRow alternates", () => {
  test("a tap sends the key with no popup", async () => {
    const key = await tabKey();
    fireEvent.touchStart(key, touch(50, 50));
    expect(popup()).toBeNull();
    fireEvent.touchEnd(key, touch(50, 50));
    expect(sendSpecialKey).toHaveBeenCalledWith("s1", "Tab", expect.anything());
  });

  test("holding shows the alternate in a popup and release sends it", async () => {
    const key = await tabKey();
    fireEvent.touchStart(key, touch(50, 50));
    act(() => { vi.advanceTimersByTime(KEY_HOLD_MS); });
    expect(popup()?.textContent).toBe("⇧Tab");
    fireEvent.touchEnd(key, touch(52, 49));
    expect(popup()).toBeNull();
    expect(sendSpecialKey).toHaveBeenCalledWith("s1", "ShiftTab", expect.anything());
  });

  test("a swipe up shows the popup before release", async () => {
    const key = await tabKey();
    fireEvent.touchStart(key, touch(50, 50));
    fireEvent.touchMove(key, touch(50, 25));
    expect(popup()?.textContent).toBe("⇧Tab");
    fireEvent.touchEnd(key, touch(50, 25));
    expect(sendSpecialKey).toHaveBeenCalledWith("s1", "ShiftTab", expect.anything());
  });

  test("dragging sideways after a hold cancels", async () => {
    const key = await tabKey();
    fireEvent.touchStart(key, touch(50, 50));
    act(() => { vi.advanceTimersByTime(KEY_HOLD_MS); });
    fireEvent.touchMove(key, touch(100, 50));
    expect(popup()).toBeNull();
    fireEvent.touchEnd(key, touch(100, 50));
    expect(sendSpecialKey).not.toHaveBeenCalled();
  });
});
