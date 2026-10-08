import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, channels } = vi.hoisted(() => ({
  invoke: vi.fn(async (..._args: unknown[]) => undefined as unknown),
  channels: [] as { id: number; onmessage: (m: unknown) => void }[],
}));

vi.mock("@/lib/invoke", () => ({
  invoke,
  Channel: class {
    id = channels.length + 1;
    onmessage: (m: unknown) => void = () => {};
    constructor() {
      channels.push(this);
    }
  },
}));

import { onTerminalClosed, onTerminalOutput } from "./terminalOutput";

const bytes = (s: string) => new TextEncoder().encode(s);
const lastChannel = () => channels[channels.length - 1];
let n = 0;
const nextId = () => `session-${++n}`;

describe("terminal output hub", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("shares one backend channel between every subscriber of a session", async () => {
    const id = nextId();
    const a = vi.fn();
    const b = vi.fn();
    const closed = vi.fn();
    await onTerminalOutput(id, true, a);
    await onTerminalOutput(id, true, b);
    await onTerminalClosed(id, true, closed);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("terminal_output_attach", { sessionId: id, gated: true, channel: lastChannel() });

    lastChannel().onmessage(bytes("héllo").buffer);
    expect(a).toHaveBeenCalledWith(bytes("héllo"));
    expect(b).toHaveBeenCalledWith(bytes("héllo"));
    expect(closed).not.toHaveBeenCalled();

    lastChannel().onmessage(true);
    expect(closed).toHaveBeenCalledWith(true);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("accepts output delivered as a plain byte array", async () => {
    const handler = vi.fn();
    await onTerminalOutput(nextId(), false, handler);
    lastChannel().onmessage([104, 105]);
    expect(handler).toHaveBeenCalledWith(bytes("hi"));
  });

  it("detaches only when the last subscriber leaves, with that channel's id", async () => {
    const id = nextId();
    const offOutput = await onTerminalOutput(id, false, vi.fn());
    const offClosed = await onTerminalClosed(id, false, vi.fn());
    const channel = lastChannel();

    offOutput();
    expect(invoke).not.toHaveBeenCalledWith("terminal_output_detach", expect.anything());
    offClosed();
    offClosed();
    expect(invoke).toHaveBeenCalledWith("terminal_output_detach", { sessionId: id, channelId: channel.id });
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "terminal_output_detach")).toHaveLength(1);

    await onTerminalOutput(id, false, vi.fn());
    expect(lastChannel()).not.toBe(channel);
    expect(invoke).toHaveBeenLastCalledWith("terminal_output_attach", { sessionId: id, gated: false, channel: lastChannel() });
  });

  it("keeps delivering to other subscribers when one throws", async () => {
    const id = nextId();
    const after = vi.fn();
    await onTerminalOutput(id, false, () => {
      throw new Error("plugin bug");
    });
    await onTerminalOutput(id, false, after);
    lastChannel().onmessage(bytes("x").buffer);
    expect(after).toHaveBeenCalledWith(bytes("x"));
  });

  it("rejects and forgets the stream when the attach fails", async () => {
    const id = nextId();
    invoke.mockRejectedValueOnce(new Error("no such command"));
    await expect(onTerminalOutput(id, false, vi.fn())).rejects.toThrow("no such command");

    await onTerminalOutput(id, false, vi.fn());
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "terminal_output_attach")).toHaveLength(2);
  });
});
