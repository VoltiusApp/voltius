import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useTerminal } from "@/hooks/useTerminal";
import { localReady, onLocalClosed, onLocalOutput } from "@/services/local";

vi.mock("@xterm/xterm", async () => ({ Terminal: (await import("@/hooks/__fixtures__/fakeXterm")).FakeTerminal }));
vi.mock("@xterm/addon-fit", async () => ({ FitAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeFitAddon }));
vi.mock("@xterm/addon-webgl", async () => ({ WebglAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeWebglAddon }));
vi.mock("@xterm/addon-web-links", async () => ({ WebLinksAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeWebLinksAddon }));
vi.mock("@xterm/addon-search", async () => ({ SearchAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeSearchAddon }));
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

describe("local startup gate", () => {
  it("acks readiness only once both output listeners are registered", async () => {
    vi.mocked(localReady).mockClear();
    let releaseOutput: (fn: () => void) => void;
    vi.mocked(onLocalOutput).mockReturnValueOnce(new Promise((r) => { releaseOutput = r; }));
    vi.mocked(onLocalClosed).mockResolvedValueOnce(() => {});

    render(<Harness sessionId="gated-session" />);
    await Promise.resolve();
    expect(localReady).not.toHaveBeenCalled();

    releaseOutput!(() => {});
    await vi.waitFor(() => expect(localReady).toHaveBeenCalledWith("gated-session"));
  });
});
