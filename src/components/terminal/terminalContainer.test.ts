// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

vi.mock("@/components/terminal/terminalClipboard", () => ({
  attachTerminalClipboard: () => ({ dispose: () => {} }),
}));
vi.mock("@/utils/webglAddon", () => ({ claimWebglRenderer: () => {} }));

import { setTerminalVisible, useTerminalMount, type CachedTerminal } from "./terminalContainer";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";

let observerCallbacks: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  observerCallbacks = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        observerCallbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mounted(): CachedTerminal & { fitAddon: { fit: ReturnType<typeof vi.fn> } } {
  const entry = {
    terminal: { element: null } as unknown as Terminal,
    fitAddon: { fit: vi.fn() } as unknown as FitAddon,
    clip: null,
  };
  const { result } = renderHook(() => useTerminalMount(() => entry, undefined, []));
  result.current(document.createElement("div"));
  return entry as never;
}

function resizeWindowAndContainer() {
  window.dispatchEvent(new Event("resize"));
  observerCallbacks.forEach((cb) => cb());
  vi.advanceTimersByTime(100);
}

describe("terminal container fits", () => {
  it("refits a visible terminal on resize", () => {
    const entry = mounted();
    resizeWindowAndContainer();
    expect(entry.fitAddon.fit).toHaveBeenCalledTimes(2);
  });

  it("skips a hidden terminal and catches it up once when it is shown", () => {
    const entry = mounted();
    setTerminalVisible(entry, false);
    resizeWindowAndContainer();
    resizeWindowAndContainer();
    expect(entry.fitAddon.fit).not.toHaveBeenCalled();

    setTerminalVisible(entry, true);
    expect(entry.fitAddon.fit).toHaveBeenCalledTimes(1);
    setTerminalVisible(entry, true);
    expect(entry.fitAddon.fit).toHaveBeenCalledTimes(1);
  });

  it("does not refit on show when nothing changed while hidden", () => {
    const entry = mounted();
    setTerminalVisible(entry, false);
    setTerminalVisible(entry, true);
    expect(entry.fitAddon.fit).not.toHaveBeenCalled();
  });
});

describe("terminal Ctrl+wheel font size", () => {
  function mountWheel() {
    const container = document.createElement("div");
    const child = document.createElement("div");
    container.appendChild(child);
    const entry = { terminal: { element: null }, fitAddon: { fit: vi.fn() }, clip: null } as unknown as CachedTerminal;
    const hook = renderHook(() => useTerminalMount(() => entry, undefined, []));
    hook.result.current(container);
    const scroll = (deltaY: number, ctrlKey = true) => {
      const event = new WheelEvent("wheel", { deltaY, ctrlKey, bubbles: true, cancelable: true });
      child.dispatchEvent(event);
      return event;
    };
    return { child, scroll, detach: () => hook.result.current(null) };
  }

  afterEach(() => useUIStore.getState().setTerminalFontSize(null));

  it("changes the shared font size and blocks terminal wheel input", () => {
    useUIStore.getState().setTerminalFontSize(14);
    const { child, scroll } = mountWheel();
    const terminalWheel = vi.fn();
    child.addEventListener("wheel", terminalWheel);
    expect(scroll(-120).defaultPrevented).toBe(true);
    expect(useUIStore.getState().terminalFontSize).toBe(15);
    scroll(120);
    expect(useUIStore.getState().terminalFontSize).toBe(14);
    expect(terminalWheel).not.toHaveBeenCalled();
  });

  it("leaves ordinary scrolling and horizontal-only wheel events untouched", () => {
    useUIStore.getState().setTerminalFontSize(14);
    const { scroll } = mountWheel();
    expect(scroll(-120, false).defaultPrevented).toBe(false);
    expect(scroll(0).defaultPrevented).toBe(false);
    expect(useUIStore.getState().terminalFontSize).toBe(14);
  });

  it("starts from the theme font size when no override is set", () => {
    useUIStore.getState().setTerminalFontSize(null);
    const size = useThemeStore.getState().getActiveTheme().terminalFontSize;
    mountWheel().scroll(-120);
    expect(useUIStore.getState().terminalFontSize).toBe(Math.min(32, size + 1));
  });

  it("clamps font size and removes the listener on detach", () => {
    const { scroll, detach } = mountWheel();
    useUIStore.getState().setTerminalFontSize(32);
    scroll(-120);
    expect(useUIStore.getState().terminalFontSize).toBe(32);
    useUIStore.getState().setTerminalFontSize(8);
    scroll(120);
    expect(useUIStore.getState().terminalFontSize).toBe(8);
    detach();
    expect(scroll(-120).defaultPrevented).toBe(false);
    expect(useUIStore.getState().terminalFontSize).toBe(8);
  });
});
