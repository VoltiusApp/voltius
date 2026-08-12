import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useTerminal } from "@/hooks/useTerminal";

vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    element: HTMLElement | null = null;
    options: Record<string, unknown> = {};
    cols = 80;
    rows = 24;
    buffer = {
      active: { length: 0, viewportY: 0, baseY: 0, cursorY: 0, getLine: () => null },
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
    attachCustomKeyEventHandler() {}
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
  localSendInput: vi.fn(), localResize: vi.fn(),
  onLocalOutput: vi.fn(async () => () => {}), onLocalClosed: vi.fn(async () => () => {}),
}));
vi.mock("@/services/serial", () => ({
  serialWrite: vi.fn(), onSerialOutput: vi.fn(async () => () => {}), onSerialClosed: vi.fn(async () => () => {}),
}));
vi.mock("@/components/terminal/terminalClipboard", () => ({
  attachTerminalClipboard: () => ({ dispose() {} }),
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

describe("useTerminal re-attach on session change", () => {
  it("swaps the terminal element when the same mount switches sessions", () => {
    const { container, rerender } = render(<Harness sessionId="session-a" />);
    const host = container.querySelector("[data-testid=host]")!;
    const firstTerm = host.firstElementChild;
    expect(firstTerm).toBeTruthy();

    rerender(<Harness sessionId="session-b" />);

    const secondTerm = host.firstElementChild;
    expect(host.childElementCount).toBe(1);
    expect(secondTerm).not.toBe(firstTerm);
  });
});
