import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { sshKillPersistent } from "./ssh";

describe("sshKillPersistent", () => {
  beforeEach(() => invoke.mockReset());

  it("passes host/session and nulls absent secrets", async () => {
    invoke.mockResolvedValue(true);
    const res = await sshKillPersistent({
      host: "h", port: 22, username: "u", password: "p", sessionId: "s1",
    });
    expect(res).toBe(true);
    expect(invoke).toHaveBeenCalledWith("ssh_kill_persistent", {
      host: "h", port: 22, username: "u",
      password: "p", privateKey: null, passphrase: null, sessionId: "s1",
    });
  });
});
