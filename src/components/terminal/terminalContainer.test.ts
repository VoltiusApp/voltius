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
