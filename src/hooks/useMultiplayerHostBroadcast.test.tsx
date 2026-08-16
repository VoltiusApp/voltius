import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  onSessionOutput: vi.fn(),
  append: vi.fn(),
  drain: vi.fn(),
}));
vi.mock("@/services/sessionInput", () => ({ onSessionOutput: h.onSessionOutput }));
vi.mock("@/services/multiplayerService", () => ({
  appendSessionOutputBuffer: h.append,
  drainSessionOutputBuffer: h.drain,
}));

import { useMultiplayerHostBroadcast } from "./useMultiplayerHostBroadcast";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import type { TerminalSession } from "@/types";

const ID = "local1";
function Harness({ id = ID, type = "ssh" as TerminalSession["type"] }: { id?: string; type?: TerminalSession["type"] }) {
  useMultiplayerHostBroadcast(id, type);
  return null;
}

// installs the onSessionOutput mock: captures the callback, hands back an unlisten spy,
// resolves `ready` once onSessionOutput has been called (so tests can await it before emitting).
function installListener() {
  const unlisten = vi.fn();
  let cb: ((d: Uint8Array) => void) | null = null;
  let resolveListen!: () => void;
  const ready = new Promise<void>((r) => (resolveListen = r));
  h.onSessionOutput.mockImplementation((_id, _type, fn) => {
    cb = fn;
    resolveListen();
    return Promise.resolve(unlisten);
  });
  return { unlisten, emit: (d: Uint8Array) => cb?.(d), ready };
}

beforeEach(() => {
  h.onSessionOutput.mockReset();
  h.append.mockReset();
  h.drain.mockReset();
  useTeamSessionStore.setState({ connections: {} } as never);
});
afterEach(() => cleanup());

test("subscribes to the session's own transport, not always ssh", () => {
  installListener();
  render(<Harness type="local" />);
  expect(h.onSessionOutput).toHaveBeenCalledWith(ID, "local", expect.any(Function));
});

test("host role forwards output via connection.sendOutput, does not buffer", async () => {
  const lst = installListener();
  const sendOutput = vi.fn(async () => {});
  useTeamSessionStore.setState({
    connections: { [ID]: { role: "host", connection: { sendOutput } } },
  } as never);
  render(<Harness />);
  await lst.ready;

  const data = new Uint8Array([1, 2]);
  act(() => lst.emit(data));

  expect(sendOutput).toHaveBeenCalledWith(data);
  expect(h.append).not.toHaveBeenCalled();
});

test("a shared local shell forwards its PTY output to the relay", async () => {
  const lst = installListener();
  const sendOutput = vi.fn(async () => {});
  useTeamSessionStore.setState({
    connections: { [ID]: { role: "host", connection: { sendOutput } } },
  } as never);
  render(<Harness type="local" />);
  await lst.ready;

  const data = new Uint8Array([9, 9]);
  act(() => lst.emit(data));

  expect(sendOutput).toHaveBeenCalledWith(data);
});

test("non-host (guest) buffers via appendSessionOutputBuffer, does not send", async () => {
  const lst = installListener();
  const sendOutput = vi.fn(async () => {});
  useTeamSessionStore.setState({
    connections: { [ID]: { role: "guest", connection: { sendOutput } } },
  } as never);
  render(<Harness />);
  await lst.ready;

  const data = new Uint8Array([3, 4]);
  act(() => lst.emit(data));

  expect(h.append).toHaveBeenCalledWith(ID, data);
  expect(sendOutput).not.toHaveBeenCalled();
});

test("no connection entry buffers (append) rather than throwing", async () => {
  const lst = installListener();
  useTeamSessionStore.setState({ connections: {} } as never);
  render(<Harness />);
  await lst.ready;

  const data = new Uint8Array([5, 6]);
  expect(() => act(() => lst.emit(data))).not.toThrow();

  expect(h.append).toHaveBeenCalledWith(ID, data);
});

test("sendOutput rejection is swallowed", async () => {
  const lst = installListener();
  const sendOutput = vi.fn(async () => {
    throw new Error("x");
  });
  useTeamSessionStore.setState({
    connections: { [ID]: { role: "host", connection: { sendOutput } } },
  } as never);
  render(<Harness />);
  await lst.ready;

  const data = new Uint8Array([7, 8]);
  act(() => lst.emit(data));
  // let the rejected promise settle
  await act(async () => {
    await Promise.resolve();
  });

  expect(sendOutput).toHaveBeenCalledWith(data);
  expect(h.append).not.toHaveBeenCalled();
});

test("cleanup on unmount calls unlisten and drains the buffer", async () => {
  const lst = installListener();
  render(<Harness />);
  await lst.ready;

  cleanup();

  expect(lst.unlisten).toHaveBeenCalled();
  expect(h.drain).toHaveBeenCalledWith(ID);
});

test("unmount before the subscription resolves disposes the late listener", async () => {
  const unlisten = vi.fn();
  let resolveSubscribe!: (fn: () => void) => void;
  h.onSessionOutput.mockImplementation(
    () =>
      new Promise<() => void>((resolve) => {
        resolveSubscribe = resolve;
      }),
  );

  const { unmount } = render(<Harness />);
  unmount();

  expect(unlisten).not.toHaveBeenCalled();
  await act(async () => {
    resolveSubscribe(unlisten);
    await Promise.resolve();
  });

  expect(unlisten).toHaveBeenCalled();
  expect(h.drain).toHaveBeenCalledWith(ID);
});
