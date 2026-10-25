// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Terminal } from "@xterm/xterm";

const writeClipboard = vi.hoisted(() => vi.fn(async () => {}));
const readClipboard = vi.hoisted(() => vi.fn(async () => ""));
vi.mock("@/utils/clipboard", () => ({ writeClipboard, readClipboard }));

const toggles = vi.hoisted(() => ({ values: {} as Record<string, boolean> }));
vi.mock("@/stores/toggleSettingsStore", () => ({
  getToggle: (id: string) => toggles.values[id] ?? true,
}));

const copyFailed = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", () => ({ logFailure: () => copyFailed }));
const platform = vi.hoisted(() => ({ os: "linux" }));
vi.mock("@/utils/platform", () => ({ isMobilePlatform: (p: string | null) => p === "android" || p === "ios", getPlatformSync: () => platform.os }));

import { attachTerminalClipboard, type TerminalClipboardHandle } from "./terminalClipboard";

const MOVE = 32;
const DOWN = 1;
const LEFT_BUTTON = 0;
const NO_BUTTON = 3;

interface Harness {
  term: Terminal;
  container: HTMLElement;
  screen: HTMLElement;
  protocol: () => string;
  cleared: () => number;
  appEvents: string[];
  selection: { text: string };
  clip: TerminalClipboardHandle;
  report: (action: number) => void;
}

function harness(
  mouseTracking: "none" | "drag" = "drag",
  buffer: "normal" | "alternate" = "alternate",
): Harness {
  const container = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  screen.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
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
  // Mirrors xterm: user input clears the selection, and every mouse report is
  // sent as user input.
  const coreService = {
    triggerDataEvent(_data: string, wasUserInput = false) { if (wasUserInput) selection.text = ""; },
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
    triggerMouseEvent(_e: { action: number }) { coreService.triggerDataEvent("report", true); return true; },
  };

  // Stand-in for xterm's own reporting listener: it forwards to the app only
  // while a mouse protocol is active, exactly like CoreBrowserTerminal.
  const drag = (e: MouseEvent) => { if (e.buttons) appEvents.push("mousemove"); };
  screen.addEventListener("mousedown", () => {
    if (coreMouseService.activeProtocol === "NONE") return;
    appEvents.push("mousedown");
    document.addEventListener("mousemove", drag);
  });
  document.addEventListener("mouseup", () => {
    document.removeEventListener("mousemove", drag);
    if (coreMouseService.activeProtocol !== "NONE") appEvents.push("mouseup");
  });

  const term = {
    element: container,
    buffer: { active: { type: buffer } },
    modes: { mouseTrackingMode: mouseTracking },
    getSelection: () => selection.text,
    clearSelection: () => { selection.text = ""; },
    onSelectionChange: () => ({ dispose() {} }),
    paste: () => {},
    loadAddon: () => {},
    _core: { coreService, coreMouseService, _selectionService },
  } as unknown as Terminal;

  const clip = attachTerminalClipboard(term, container);
  return {
    term, container, screen, appEvents, selection, clip,
    report: (action) => { coreMouseService.triggerMouseEvent({ action }); },
    protocol: () => coreMouseService.activeProtocol,
    cleared: () => _selectionService.cleared,
  };
}

function press(target: HTMLElement, init: MouseEventInit = {}) {
  target.dispatchEvent(new MouseEvent("mousedown", {
    bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10, detail: 1, ...init,
  }));
}

function move(init: MouseEventInit = {}) {
  document.dispatchEvent(new MouseEvent("mousemove", {
    bubbles: true, cancelable: true, buttons: 1, clientX: 10, clientY: 10, ...init,
  }));
}

function release(init: MouseEventInit = {}) {
  document.dispatchEvent(new MouseEvent("mouseup", {
    bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10, ...init,
  }));
}

function copyShortcut(h: Harness) {
  h.clip.handleKeyEvent(new KeyboardEvent("keydown", { key: "C", ctrlKey: true, shiftKey: true }));
}

const badge = () => document.body.querySelector("div[style*='position: fixed']");

beforeEach(() => {
  toggles.values = {};
  writeClipboard.mockReset();
  readClipboard.mockReset();
  readClipboard.mockImplementation(async () => "");
  copyFailed.mockReset();
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

  it("copies the drag selection and shows the badge when select-to-copy is on", async () => {
    const h = harness();
    press(h.screen);
    h.selection.text = "copied";
    release({ clientX: 90, clientY: 10 });
    expect(writeClipboard).toHaveBeenCalledWith("copied");
    await Promise.resolve();
    expect(badge()).not.toBeNull();
  });

  it("shows no badge when the clipboard write fails", async () => {
    writeClipboard.mockRejectedValueOnce(new Error("denied"));
    const h = harness();
    press(h.screen);
    h.selection.text = "copied";
    release({ clientX: 90, clientY: 10 });
    await Promise.resolve();
    await Promise.resolve();
    expect(badge()).toBeNull();
    expect(copyFailed).toHaveBeenCalled();
  });

  it("keeps the selection through the app's motion reports until a press", () => {
    toggles.values = { "select-to-copy": false };
    const h = harness();
    press(h.screen);
    h.selection.text = "kept";
    release({ clientX: 90, clientY: 10 });
    expect(writeClipboard).not.toHaveBeenCalled();
    h.report(MOVE);
    expect(h.selection.text).toBe("kept");
    copyShortcut(h);
    expect(writeClipboard).toHaveBeenCalledWith("kept");
    h.report(DOWN);
    expect(h.selection.text).toBe("");
  });

  it("restores xterm's reporting on dispose", () => {
    const h = harness();
    h.clip.dispose();
    h.selection.text = "kept";
    h.report(MOVE);
    expect(h.selection.text).toBe("");
  });

  it.each([
    ["top", -5],
    ["bottom", 130],
  ])("hands a drag past the %s edge of the alternate screen to the app", (_edge, clientY) => {
    const h = harness();
    press(h.screen);
    move({ clientY: 60 });
    expect(h.protocol()).toBe("NONE");
    h.selection.text = "partial";
    move({ clientY });
    expect(h.protocol()).toBe("VT200");
    expect(h.selection.text).toBe("");
    expect(h.appEvents).toEqual(["mousedown", "mousemove"]);
    release({ clientY });
    expect(h.appEvents).toEqual(["mousedown", "mousemove", "mouseup"]);
  });

  it("keeps a drag past the edge local on the normal screen", () => {
    const h = harness("drag", "normal");
    press(h.screen);
    move({ clientY: -5 });
    expect(h.protocol()).toBe("NONE");
    expect(h.appEvents).toEqual([]);
  });
});

describe("against the real xterm", () => {
  it("does not count mouse motion reports as user input", async () => {
    const term = new Terminal({ allowProposedApi: true });
    const clip = attachTerminalClipboard(term, document.createElement("div"));
    await new Promise<void>((resolve) => term.write("\x1b[?1003h\x1b[?1006h", resolve));
    const core = (term as unknown as {
      _core: {
        coreService: { onUserInput(listener: () => void): void };
        coreMouseService: { triggerMouseEvent(e: object): boolean };
      };
    })._core;
    const userInput = vi.fn();
    core.coreService.onUserInput(userInput);
    const sent: string[] = [];
    term.onData((d) => sent.push(d));
    const report = (col: number, button: number, action: number) =>
      core.coreMouseService.triggerMouseEvent({ col, row: 0, x: 0, y: 0, button, action, ctrl: false, alt: false, shift: false });

    report(1, NO_BUTTON, MOVE);
    expect(sent).toHaveLength(1);
    expect(userInput).not.toHaveBeenCalled();
    report(1, LEFT_BUTTON, DOWN);
    expect(userInput).toHaveBeenCalledTimes(1);

    clip.dispose();
    report(2, NO_BUTTON, MOVE);
    expect(userInput).toHaveBeenCalledTimes(2);
  });
});

describe("paste", () => {
  function pasteHarness(clipboard: string | Error) {
    if (clipboard instanceof Error) readClipboard.mockRejectedValueOnce(clipboard);
    else readClipboard.mockResolvedValueOnce(clipboard);
    const pasted: string[] = [];
    const pasteImage = vi.fn(async () => {});
    const term = {
      onSelectionChange: () => ({ dispose() {} }),
      paste: (text: string) => pasted.push(text),
      getSelection: () => "",
    } as unknown as Terminal;
    const clip = attachTerminalClipboard(term, document.createElement("div"), { pasteImage });
    return { clip, pasted, pasteImage };
  }
  const ctrlV = () => new KeyboardEvent("keydown", { key: "v", ctrlKey: true });

  it("pastes clipboard text", async () => {
    const h = pasteHarness("ls -la");
    expect(h.clip.handleKeyEvent(ctrlV())).toBe(false);
    await vi.waitFor(() => expect(h.pasted).toEqual(["ls -la"]));
    expect(h.pasteImage).not.toHaveBeenCalled();
  });

  it("hands a clipboard without text to pasteImage", async () => {
    const h = pasteHarness("");
    h.clip.handleKeyEvent(new KeyboardEvent("keydown", { key: "V", ctrlKey: true, shiftKey: true }));
    await vi.waitFor(() => expect(h.pasteImage).toHaveBeenCalledOnce());
    expect(h.pasted).toEqual([]);
  });

  it("pastes with Cmd+V on macOS only", async () => {
    const cmdV = () => new KeyboardEvent("keydown", { key: "v", metaKey: true });
    const linux = pasteHarness("ls");
    expect(linux.clip.handleKeyEvent(cmdV())).toBeNull();
    platform.os = "macos";
    const mac = pasteHarness("ls");
    expect(mac.clip.handleKeyEvent(cmdV())).toBe(false);
    await vi.waitFor(() => expect(mac.pasted).toEqual(["ls"]));
    platform.os = "linux";
  });

  it("treats an unreadable clipboard as one without text", async () => {
    const h = pasteHarness(new Error("denied"));
    h.clip.handleKeyEvent(ctrlV());
    await vi.waitFor(() => expect(h.pasteImage).toHaveBeenCalledOnce());
  });
});
