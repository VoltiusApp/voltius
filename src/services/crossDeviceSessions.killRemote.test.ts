import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Connection } from "@/types";

const sshKillPersistent = vi.fn();
const resolveConnectionCredentials = vi.fn();
const markClosed = vi.fn();
const publishLiveSessionsNow = vi.fn();

vi.mock("@/services/ssh", () => ({ sshKillPersistent: (...a: unknown[]) => sshKillPersistent(...a) }));
vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: (...a: unknown[]) => resolveConnectionCredentials(...a),
}));
vi.mock("@/services/liveSessionPublisher", () => ({
  publishLiveSessionsNow: (...a: unknown[]) => publishLiveSessionsNow(...a),
}));
vi.mock("@/stores/crossDeviceSessionsStore", () => ({
  useCrossDeviceSessionsStore: { getState: () => ({ markClosed }) },
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: { getState: () => ({ connections: conns, teamConnections: {} }) },
}));

let conns: Connection[] = [];
function conn(over: Partial<Connection> = {}): Connection {
  return { id: "c1", name: "web", host: "h", port: 22, username: "u", auth_type: "password", ...over } as Connection;
}
const remote = { sessionId: "s1", connectionId: "c1", connectionName: "web", deviceId: "d", deviceName: "D", openedAt: "" };

import { killRemoteSession } from "./crossDeviceSessions";

beforeEach(() => {
  vi.clearAllMocks();
  conns = [conn()];
});

describe("killRemoteSession", () => {
  it("kills, tombstones and republishes on success", async () => {
    resolveConnectionCredentials.mockResolvedValue({ username: "u", password: "p" });
    sshKillPersistent.mockResolvedValue(true);
    const res = await killRemoteSession(remote as never);
    expect(res).toEqual({ ok: true });
    expect(sshKillPersistent).toHaveBeenCalledWith(
      expect.objectContaining({ host: "h", port: 22, username: "u", password: "p", sessionId: "s1" }),
    );
    expect(markClosed).toHaveBeenCalledWith("s1");
    expect(publishLiveSessionsNow).toHaveBeenCalled();
  });

  it("returns unsupported for jump-host connections without touching the host", async () => {
    conns = [conn({ jump_hosts: [{ connection_id: "j1" }] as never })];
    const res = await killRemoteSession(remote as never);
    expect(res).toEqual({ ok: false, reason: "unsupported" });
    expect(sshKillPersistent).not.toHaveBeenCalled();
    expect(markClosed).not.toHaveBeenCalled();
    expect(publishLiveSessionsNow).not.toHaveBeenCalled();
  });

  it("returns unsupported when no stored credentials resolve", async () => {
    resolveConnectionCredentials.mockResolvedValue({ username: "u" });
    const res = await killRemoteSession(remote as never);
    expect(res).toEqual({ ok: false, reason: "unsupported" });
    expect(sshKillPersistent).not.toHaveBeenCalled();
    expect(markClosed).not.toHaveBeenCalled();
    expect(publishLiveSessionsNow).not.toHaveBeenCalled();
  });

  it("returns error and does not tombstone when the kill throws", async () => {
    resolveConnectionCredentials.mockResolvedValue({ username: "u", password: "p" });
    sshKillPersistent.mockRejectedValue(new Error("auth"));
    const res = await killRemoteSession(remote as never);
    expect(res).toEqual({ ok: false, reason: "error" });
    expect(markClosed).not.toHaveBeenCalled();
    expect(publishLiveSessionsNow).not.toHaveBeenCalled();
  });
});
