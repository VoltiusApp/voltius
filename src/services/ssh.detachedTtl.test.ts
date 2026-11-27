import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

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
