import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Terminal } from "@xterm/xterm";

const writeClipboard = vi.hoisted(() => vi.fn(async () => {}));
const readClipboard = vi.hoisted(() => vi.fn(async () => ""));
vi.mock("@/utils/clipboard", () => ({ writeClipboard, readClipboard }));

const toggles = vi.hoisted(() => ({ values: {} as Record<string, boolean> }));
vi.mock("@/stores/toggleSettingsStore", () => ({
  getToggle: (id: string) => toggles.values[id] ?? true,
}));

import { attachTerminalClipboard } from "./terminalClipboard";

interface Harness {
  term: Terminal;
  container: HTMLElement;
  screen: HTMLElement;
  protocol: () => string;
  cleared: () => number;
  appEvents: string[];
  selection: { text: string };
}

function harness(mouseTracking: "none" | "drag" = "drag"): Harness {
  const container = document.createElement("div");
  const screen = document.createElement("div");
  container.appendChild(screen);
  document.body.appendChild(container);

  const appEvents: string[] = [];
  const selection = { text: "" };
  const _selectionService = {
    _enabled: false,
    cleared: 0,
    disable() { this.cleared++; this._enabled = false; selection.text = ""; },
    enable() { this._enabled = true; },
  };
  // Mirrors xterm: a protocol change enables/disables selection, and disabling
  // it clears whatever was selected.
  const coreMouseService = {
    _protocol: "VT200",
    get activeProtocol() { return this._protocol; },
    set activeProtocol(name: string) {
      this._protocol = name;
      if (name === "NONE") _selectionService.enable();
      else _selectionService.disable();
    },
  };

  // Stand-in for xterm's own reporting listener: it forwards to the app only
  // while a mouse protocol is active, exactly like CoreBrowserTerminal.
  screen.addEventListener("mousedown", () => {
    if (coreMouseService.activeProtocol !== "NONE") appEvents.push("mousedown");
  });
  document.addEventListener("mouseup", () => {
    if (coreMouseService.activeProtocol !== "NONE") appEvents.push("mouseup");
  });

  const term = {
    modes: { mouseTrackingMode: mouseTracking },
    getSelection: () => selection.text,
    onSelectionChange: () => ({ dispose() {} }),
    paste: () => {},
    loadAddon: () => {},
    _core: { coreMouseService, _selectionService },
  } as unknown as Terminal;

  attachTerminalClipboard(term, container);
  return {
    term, container, screen, appEvents, selection,
    protocol: () => coreMouseService.activeProtocol,
    cleared: () => _selectionService.cleared,
  };
}

function press(target: HTMLElement, init: MouseEventInit = {}) {
  target.dispatchEvent(new MouseEvent("mousedown", {
    bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10, detail: 1, ...init,
  }));
}

function release(init: MouseEventInit = {}) {
  window.dispatchEvent(new MouseEvent("mouseup", {
    bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10, ...init,
  }));
}

beforeEach(() => {
  toggles.values = {};
  writeClipboard.mockClear();
  document.body.innerHTML = "";
});

describe("drag-selects-text over an app holding the mouse", () => {
  it("parks the mouse protocol for a plain press and restores it on release", () => {
    const h = harness();
    press(h.screen);
    expect(h.protocol()).toBe("NONE");
    expect(h.appEvents).toEqual([]);
    h.selection.text = "picked";
    release({ clientX: 90, clientY: 10 });
    expect(h.protocol()).toBe("VT200");
  });

  it("hands a click that never moved to the app", () => {
    const h = harness();
    press(h.screen);
    release();
    expect(h.appEvents).toEqual(["mousedown", "mouseup"]);
    expect(h.protocol()).toBe("VT200");
  });

  it("leaves a modified press to the app", () => {
    const h = harness();
    press(h.screen, { ctrlKey: true });
    expect(h.protocol()).toBe("VT200");
    expect(h.appEvents).toEqual(["mousedown"]);
  });

  it("does nothing when the toggle is off", () => {
    toggles.values = { "drag-selects-text": false };
    const h = harness();
    press(h.screen);
    expect(h.protocol()).toBe("VT200");
    expect(h.appEvents).toEqual(["mousedown"]);
  });

  it("does nothing when no app holds the mouse", () => {
    const h = harness("none");
    press(h.screen);
    expect(h.protocol()).toBe("VT200");
  });

  it("keeps the drag selection when the protocol is handed back", () => {
    const h = harness();
    press(h.screen);
    h.selection.text = "kept";
    release({ clientX: 90, clientY: 10 });
    expect(h.protocol()).toBe("VT200");
    expect(h.selection.text).toBe("kept");
    expect(h.cleared()).toBe(0);
  });

  it("copies the drag selection when select-to-copy is on", async () => {
    vi.useFakeTimers();
    const h = harness();
    press(h.screen);
    h.selection.text = "copied";
    release({ clientX: 90, clientY: 10 });
    await vi.advanceTimersByTimeAsync(30);
    expect(writeClipboard).toHaveBeenCalledWith("copied");
    vi.useRealTimers();
  });
});
