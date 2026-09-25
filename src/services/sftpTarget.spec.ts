import { describe, it, expect, vi, beforeEach } from "vitest";

const sftpOpen = vi.fn();
const sftpConnect = vi.fn();
vi.mock("@/services/sftp", () => ({ sftpOpen: (...a: unknown[]) => sftpOpen(...a), sftpConnect: (...a: unknown[]) => sftpConnect(...a) }));
vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: vi.fn(async () => ({ username: "u", password: "p" })),
  resolveJumpHosts: vi.fn(async () => []),
}));
vi.mock("@/utils/keepalive", () => ({ resolveKeepalive: () => ({ intervalSecs: 30, max: 3 }) }));

let connectivityState = { proxy: { mode: "none" } };
vi.mock("@/stores/connectivitySettingsStore", () => ({
  getGlobalKeepalivePreset: () => null,
  getGlobalProxy: () => connectivityState.proxy,
  useConnectivitySettingsStore: {
    setState: (partial: Partial<typeof connectivityState>) => {
      connectivityState = { ...connectivityState, ...partial };
    },
    getState: () => connectivityState,
  },
}));
vi.mock("@/services/vault", () => ({ getSecret: vi.fn(async () => null) }));
vi.mock("@/components/filetransfer/SFTPTypes", () => ({ genId: () => "gen" }));

import { resolveSftpIdForTarget, sftpConnectToConnection } from "./sftpTarget";
import { useConnectivitySettingsStore } from "@/stores/connectivitySettingsStore";
import type { Connection } from "@/types";

beforeEach(() => {
  sftpOpen.mockReset();
  sftpConnect.mockReset();
  connectivityState = { proxy: { mode: "none" } };
});

describe("resolveSftpIdForTarget", () => {
  it("uses sftp_open for a live session", async () => {
    sftpOpen.mockResolvedValue("sftp-1");
    const id = await resolveSftpIdForTarget({ kind: "session", sessionId: "s1", sessionType: "ssh" });
    expect(id).toBe("sftp-1");
    expect(sftpOpen).toHaveBeenCalledWith("s1");
    expect(sftpConnect).not.toHaveBeenCalled();
  });

  it("uses sftp_connect for a saved connection", async () => {
    sftpConnect.mockResolvedValue("sftp-2");
    const conn = { id: "c1", host: "h", port: 22, username: "u" } as Connection;
    const id = await resolveSftpIdForTarget({ kind: "connection", connection: conn });
    expect(id).toBe("sftp-2");
    expect(sftpConnect).toHaveBeenCalled();
    expect(sftpOpen).not.toHaveBeenCalled();
  });

  it("forwards the connection's legacy-algorithms toggle", async () => {
    sftpConnect.mockResolvedValue("sftp-3");
    const conn = { id: "c1", host: "h", port: 22, username: "u", legacy_algorithms: true } as Connection;
    await resolveSftpIdForTarget({ kind: "connection", connection: conn });
    expect(sftpConnect).toHaveBeenCalledWith(expect.objectContaining({ legacyAlgorithms: true }));
  });

  it("passes the resolved proxy", async () => {
    useConnectivitySettingsStore.setState({ proxy: { mode: "http", host: "p", port: 3128 } } as never);
    sftpConnect.mockResolvedValue("sftp-4");
    const conn = { id: "c1", host: "h", port: 22, username: "u", legacy_algorithms: false } as Connection;
    await sftpConnectToConnection(conn, "cid");
    expect(sftpConnect).toHaveBeenCalledWith(
      expect.objectContaining({ proxy: { kind: "http", host: "p", port: 3128 } }),
    );
  });
});
