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
  const verifying = { state: "verify", url, banner: `Visit ${url}`, autoOpen: true };
  const pending = { state: "authenticating" };
  let channel: { onmessage: (message: object) => void };
  invoke.mockImplementationOnce(async (_command, args) => {
    channel = args.onVerification;
    channel.onmessage(pending);
    channel.onmessage(verifying);
    channel.onmessage({ state: "idle" });
    throw new Error("disconnected");
  });
  await expect(sshConnect({ ...base, onVerification })).rejects.toThrow("disconnected");
  channel!.onmessage(verifying);
  expect(onVerification.mock.calls).toEqual([[pending], [verifying], [undefined], []]);
});

it("sends NetBird settings only with a challenge channel and clears the code when the attempt ends", async () => {
  const netbird = { issuer: "https://id.example", client_id: "public", scope: "", audience: "",
    token_type: "id_token" as const, fingerprint: "SHA256:" + "A".repeat(43) };
  const onNetbirdChallenge = vi.fn();
  const challenge = { verificationUri: "https://id.example/device", userCode: "ABCD" };
  invoke.mockImplementationOnce(async (_command, args) => {
    expect(args.netbird).toEqual(netbird);
    args.onNetbirdChallenge.onmessage(challenge);
    args.onNetbirdChallenge.onmessage(null);
  });
  await sshConnect({ ...base, netbird, onNetbirdChallenge });
  expect(onNetbirdChallenge.mock.calls).toEqual([[challenge], [undefined], []]);

  invoke.mockImplementationOnce(async (_command, args) => expect(args.netbird).toBeNull());
  await sshConnect({ ...base, netbird });
});
