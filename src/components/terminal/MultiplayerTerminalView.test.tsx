import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { FakeTerminal, resetFakeXterm } from "@/hooks/__fixtures__/fakeXterm";
import { useSessionStore } from "@/stores/sessionStore";
import type { TerminalSession } from "@/types";

vi.mock("@xterm/xterm", async () => ({ Terminal: (await import("@/hooks/__fixtures__/fakeXterm")).FakeTerminal }));
vi.mock("@xterm/addon-fit", async () => ({ FitAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeFitAddon }));
vi.mock("@xterm/addon-webgl", async () => ({ WebglAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeWebglAddon }));
vi.mock("@/components/terminal/terminalClipboard", () => ({
  attachTerminalClipboard: () => ({ handleKeyEvent: () => null, dispose() {} }),
}));
const h = vi.hoisted(() => ({
  detach: vi.fn(),
  write: null as ((data: Uint8Array) => void) | null,
}));
vi.mock("@/stores/teamSessionStore", () => ({
  attachGuestOutput: (_id: string, write: (data: Uint8Array) => void) => {
    h.write = write;
    return h.detach;
  },
  useTeamSessionStore: { getState: () => ({ connections: {} }) },
}));

import MultiplayerTerminalView from "./MultiplayerTerminalView";

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
