import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  onSshOutput: vi.fn(),
  append: vi.fn(),
  drain: vi.fn(),
}));
vi.mock("@/services/ssh", () => ({ onSshOutput: h.onSshOutput }));
vi.mock("@/services/multiplayerService", () => ({
  appendSshOutputBuffer: h.append,
  drainSshOutputBuffer: h.drain,
}));

import { useMultiplayerHostBroadcast } from "./useMultiplayerHostBroadcast";
import { useTeamSessionStore } from "@/stores/teamSessionStore";

const ID = "local1";
function Harness({ id = ID }: { id?: string }) {
  useMultiplayerHostBroadcast(id);
  return null;
}

// installs onSshOutput mock: captures the callback, hands back an unlisten spy,
// resolves `ready` once onSshOutput has been called (so tests can await it before emitting).
function installListener() {
  const unlisten = vi.fn();
  let cb: ((d: Uint8Array) => void) | null = null;
  let resolveListen!: () => void;
  const ready = new Promise<void>((r) => (resolveListen = r));
  h.onSshOutput.mockImplementation((_id, fn) => {
    cb = fn;
    resolveListen();
    return Promise.resolve(unlisten);
  });
  return { unlisten, emit: (d: Uint8Array) => cb?.(d), ready };
}

beforeEach(() => {
  h.onSshOutput.mockReset();
  h.append.mockReset();
  h.drain.mockReset();
  useTeamSessionStore.setState({ connections: {} } as never);
});
afterEach(() => cleanup());

test("subscribes to onSshOutput for the given session id", () => {
  installListener();
  render(<Harness />);
  expect(h.onSshOutput).toHaveBeenCalledWith(ID, expect.any(Function));
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

test("non-host (guest) buffers via appendSshOutputBuffer, does not send", async () => {
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

test("unmount before onSshOutput resolves disposes the late listener", async () => {
  const unlisten = vi.fn();
  let resolveOnSshOutput!: (fn: () => void) => void;
  h.onSshOutput.mockImplementation(
    () =>
      new Promise<() => void>((resolve) => {
        resolveOnSshOutput = resolve;
      }),
  );

  const { unmount } = render(<Harness />);
  unmount();

  expect(unlisten).not.toHaveBeenCalled();
  await act(async () => {
    resolveOnSshOutput(unlisten);
    await Promise.resolve();
  });

  expect(unlisten).toHaveBeenCalled();
  expect(h.drain).toHaveBeenCalledWith(ID);
});
