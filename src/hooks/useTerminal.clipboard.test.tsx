import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useTerminal } from "@/hooks/useTerminal";

const keyHandlers = new Map<string, (e: KeyboardEvent) => boolean>();

vi.mock("@xterm/xterm", () => {
  let seq = 0;
  class FakeTerminal {
    id = `term-${(seq += 1)}`;
    element: HTMLElement | null = null;
    options: Record<string, unknown> = {};
    cols = 80;
    rows = 24;
    modes = { applicationCursorKeysMode: false, mouseTrackingMode: "none" };
    buffer = {
      active: { length: 0, viewportY: 0, baseY: 0, cursorY: 0, type: "normal", getLine: () => null },
      onBufferChange: () => ({ dispose() {} }),
    };
    open(container: HTMLElement) {
      this.element = document.createElement("div");
      container.appendChild(this.element);
    }
    parser = { registerOscHandler: () => ({ dispose() {} }) };
    loadAddon() {}
    write() {}
    focus() {}
    dispose() {}
    attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean) { keyHandlers.set(this.id, fn); }
    attachCustomWheelEventHandler() {}
    onData() { return { dispose() {} }; }
    onBinary() { return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
    onScroll() { return { dispose() {} }; }
    onLineFeed() { return { dispose() {} }; }
    onRender() { return { dispose() {} }; }
    onWriteParsed() { return { dispose() {} }; }
    registerLinkProvider() { return { dispose() {} }; }
    registerDecoration() { return null; }
  }
  return { Terminal: FakeTerminal };
});
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} proposeDimensions() { return { cols: 80, rows: 24 }; } } }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class { onContextLoss() { return { dispose() {} }; } dispose() {} } }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext() { return false; }
    findPrevious() { return false; }
    clearDecorations() {}
    onDidChangeResults() { return { dispose() {} }; }
  },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/services/ssh", () => ({
  sshSendInput: vi.fn(), sshResize: vi.fn(),
  onSshOutput: vi.fn(async () => () => {}), onSshClosed: vi.fn(async () => () => {}), onSshCwd: vi.fn(async () => () => {}),
}));
vi.mock("@/services/local", () => ({
  localSendInput: vi.fn(), localResize: vi.fn(), localReady: vi.fn(async () => {}),
  onLocalOutput: vi.fn(async () => () => {}), onLocalClosed: vi.fn(async () => () => {}),
}));
vi.mock("@/services/serial", () => ({
  serialWrite: vi.fn(), onSerialOutput: vi.fn(async () => () => {}), onSerialClosed: vi.fn(async () => () => {}),
}));

const clips: { termId: string; handleKeyEvent: ReturnType<typeof vi.fn> }[] = [];
vi.mock("@/components/terminal/terminalClipboard", () => ({
  attachTerminalClipboard: (term: { id: string }) => {
    const clip = { termId: term.id, handleKeyEvent: vi.fn(() => false), dispose() {} };
    clips.push(clip);
    return clip;
  },
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function Harness({ sessionId }: { sessionId: string }) {
  const { attach } = useTerminal({ sessionId, sessionType: "local" });
  return <div data-testid="host" ref={attach} />;
}

describe("terminal clipboard routing", () => {
  it("routes Ctrl+V to the terminal that received the key, not the mount's last session", () => {
    // A pane creates session-a's terminal, then switches to session-b.
    const first = render(<Harness sessionId="session-a" />);
    first.rerender(<Harness sessionId="session-b" />);
    // session-a re-mounts elsewhere (dragged back out to its own tab).
    render(<Harness sessionId="session-a" />);

    const last = (termId: string) => {
      const matches = clips.filter((c) => c.termId === termId);
      return matches[matches.length - 1];
    };
    const clipA = last("term-1");
    const clipB = last("term-2");

    const paste = new KeyboardEvent("keydown", { key: "v", ctrlKey: true });
    keyHandlers.get("term-1")!(paste);

    expect(clipA.handleKeyEvent).toHaveBeenCalledTimes(1);
    expect(clipB.handleKeyEvent).not.toHaveBeenCalled();
  });
});
