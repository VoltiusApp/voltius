import { it, expect, vi } from "vitest";

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

it("clears the verification link when the check settles or the attempt ends, and ignores late messages", async () => {
  const onVerification = vi.fn();
  const url = "https://login.tailscale.com/a/test";
  let channel: { onmessage: (url: string) => void };
  invoke.mockImplementationOnce(async (_command, args) => {
    channel = args.onVerification;
    channel.onmessage(url);
    channel.onmessage("");
    throw new Error("disconnected");
  });
  await expect(sshConnect({ ...base, onVerification })).rejects.toThrow("disconnected");
  channel!.onmessage(url);
  expect(onVerification.mock.calls).toEqual([[url], [undefined], []]);
});
