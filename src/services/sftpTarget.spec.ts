import { describe, it, expect, vi, beforeEach } from "vitest";

const sftpOpen = vi.fn();
const sftpConnect = vi.fn();
vi.mock("@/services/sftp", () => ({ sftpOpen: (...a: unknown[]) => sftpOpen(...a), sftpConnect: (...a: unknown[]) => sftpConnect(...a) }));
vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: vi.fn(async () => ({ username: "u", password: "p" })),
  resolveJumpHosts: vi.fn(async () => []),
}));
vi.mock("@/utils/keepalive", () => ({ resolveKeepalive: () => ({ intervalSecs: 30, max: 3 }) }));
vi.mock("@/stores/connectivitySettingsStore", () => ({ getGlobalKeepalivePreset: () => null }));
vi.mock("@/components/filetransfer/SFTPTypes", () => ({ genId: () => "gen" }));

import { resolveSftpIdForTarget } from "./sftpTarget";
import type { Connection } from "@/types";

beforeEach(() => { sftpOpen.mockReset(); sftpConnect.mockReset(); });

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
});
