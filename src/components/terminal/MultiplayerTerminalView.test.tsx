import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { FakeTerminal, resetFakeXterm } from "@/hooks/__fixtures__/fakeXterm";
import { useSessionStore } from "@/stores/sessionStore";
import type { TerminalSession } from "@/types";

vi.mock("@xterm/xterm", async () => ({ Terminal: (await import("@/hooks/__fixtures__/fakeXterm")).FakeTerminal }));
vi.mock("@xterm/addon-fit", async () => ({ FitAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeFitAddon }));
vi.mock("@xterm/addon-webgl", async () => ({ WebglAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeWebglAddon }));
vi.mock("@/components/terminal/terminalClipboard", () => ({
  attachTerminalClipboard: () => ({ handleKeyEvent: () => null, selectionText: () => "", dispose() {} }),
}));
const queries = vi.hoisted(() => ({ suppress: vi.fn(() => ({ dispose: vi.fn() })) }));
vi.mock("@/components/terminal/terminalQueries", () => ({ suppressTerminalQueries: queries.suppress }));
const h = vi.hoisted(() => ({
  detach: vi.fn(),
  write: null as ((data: Uint8Array) => void) | null,
  connections: {} as Record<string, unknown>,
}));
vi.mock("@/stores/teamSessionStore", () => ({
  attachGuestOutput: (_id: string, write: (data: Uint8Array) => void) => {
    h.write = write;
    return h.detach;
  },
  useTeamSessionStore: { getState: () => ({ connections: h.connections }) },
}));

import MultiplayerTerminalView from "./MultiplayerTerminalView";
import { getTerminalApi, sessionAcceptsInput, writeToSession } from "@/hooks/useTerminal";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const guest = (id: string) => ({ id, connectionId: "m1", connectionName: "shared", status: "connected", type: "multiplayer" }) as TerminalSession;

beforeEach(() => {
  resetFakeXterm();
  h.detach.mockClear();
  useSessionStore.setState({ sessions: [guest("g1")] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Regression guard: every mount built a fresh xterm and every unmount disposed
// it, so moving a guest tab into a split pane wiped its screen and scrollback.
test("a remounted guest view keeps its terminal", () => {
  const dispose = vi.spyOn(FakeTerminal.prototype, "dispose");
  const first = render(<MultiplayerTerminalView localSessionId="g1" />);
  const termEl = first.container.querySelector(".pl-\\[14px\\]")!.firstElementChild;
  expect(termEl).toBeTruthy();
  first.unmount();

  const second = render(<MultiplayerTerminalView localSessionId="g1" />);
  expect(second.container.querySelector(".pl-\\[14px\\]")!.firstElementChild).toBe(termEl);
  expect(dispose).not.toHaveBeenCalled();
});

test("the terminal is written by the session's output and torn down with its tab", () => {
  useSessionStore.setState({ sessions: [guest("g2")] }); // tears down g1, cached by the test above
  h.detach.mockClear();
  const write = vi.spyOn(FakeTerminal.prototype, "write");
  const dispose = vi.spyOn(FakeTerminal.prototype, "dispose");
  render(<MultiplayerTerminalView localSessionId="g2" />);

  h.write!(new Uint8Array([0x68, 0x69]));
  expect(write).toHaveBeenCalledWith(new Uint8Array([0x68, 0x69]));

  useSessionStore.setState({ sessions: [] });
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(h.detach).toHaveBeenCalledTimes(1);
});

test("a guest terminal never answers terminal queries itself", () => {
  useSessionStore.setState({ sessions: [guest("g3")] });
  queries.suppress.mockClear();
  render(<MultiplayerTerminalView localSessionId="g3" />);
  expect(queries.suppress).toHaveBeenCalledTimes(1);
});

describe("guest input", () => {
  const sendInput = vi.fn(async () => {});
  const connect = (id: string, over: Record<string, unknown> = {}) => {
    h.connections[id] = { role: "guest", myUserId: "me", controlHolder: "host", connection: { sendInput }, ...over };
  };
  const sent = () => sendInput.mock.calls.map((c) => new TextDecoder().decode((c as unknown as [Uint8Array])[0]));
  let typed: (data: string) => void;

  beforeEach(() => {
    sendInput.mockClear();
    h.connections = {};
    vi.spyOn(FakeTerminal.prototype, "onData").mockImplementation(((fn: (data: string) => void) => {
      typed = fn;
      return { dispose() {} };
    }) as never);
  });

  test("a watching guest's keys and xterm input never leave", () => {
    useSessionStore.setState({ sessions: [guest("w1")] });
    connect("w1");
    render(<MultiplayerTerminalView localSessionId="w1" />);

    expect(getTerminalApi("w1")).not.toBeNull();
    expect(sessionAcceptsInput("w1")).toBe(false);
    writeToSession("w1", "ls\r");
    typed("x");
    expect(sendInput).not.toHaveBeenCalled();
  });

  test("the control holder's keys go out on the guest connection", () => {
    useSessionStore.setState({ sessions: [guest("c1")] });
    connect("c1", { controlHolder: "me" });
    render(<MultiplayerTerminalView localSessionId="c1" />);

    expect(sessionAcceptsInput("c1")).toBe(true);
    writeToSession("c1", "\x1b[A");
    typed("y");
    expect(sent()).toEqual(["\x1b[A", "y"]);
  });

  test("an ended session blocks even the last control holder", () => {
    useSessionStore.setState({ sessions: [guest("e1")] });
    connect("e1", { controlHolder: "me", ended: true });
    render(<MultiplayerTerminalView localSessionId="e1" />);

    expect(sessionAcceptsInput("e1")).toBe(false);
    writeToSession("e1", "q");
    expect(sendInput).not.toHaveBeenCalled();
  });
});
