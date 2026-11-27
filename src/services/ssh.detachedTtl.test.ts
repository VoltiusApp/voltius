import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
  Channel: class {
    constructor(public onmessage: (url: string) => void) {}
  },
}));

import { sshConnect } from "./ssh";

const base = {
  sessionId: "s1", host: "h", port: 22, username: "u",
  keepaliveIntervalSecs: 15, keepaliveMax: 3,
};

describe("sshConnect detachedTtlSecs", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("forwards detachedTtlSecs", async () => {
    await sshConnect({ ...base, detachedTtlSecs: 86400 });
    expect(invoke.mock.calls[0][1].detachedTtlSecs).toBe(86400);
  });

  it("sends null when omitted", async () => {
    await sshConnect(base);
    expect(invoke.mock.calls[0][1].detachedTtlSecs).toBeNull();
  });
});

it("clears the verification link and ignores late messages when the attempt ends", async () => {
  const onVerification = vi.fn();
  const url = "https://login.tailscale.com/a/test";
  let channel: { onmessage: (url: string) => void };
  invoke.mockImplementationOnce(async (_command, args) => {
    channel = args.onVerification;
    channel.onmessage(url);
    throw new Error("disconnected");
  });
  await expect(sshConnect({ ...base, onVerification })).rejects.toThrow("disconnected");
  channel!.onmessage(url);
  expect(onVerification.mock.calls).toEqual([[url], []]);
});
