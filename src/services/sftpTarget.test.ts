import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Connection } from "@/types";

const svc = vi.hoisted(() => ({
  sftpConnect: vi.fn(async () => "sftp-1"),
  ftpConnect: vi.fn(async () => "ftp-1"),
  webdavConnect: vi.fn(async (_p: { interactive: boolean }) => "dav-1"),
  sftpOpen: vi.fn(async () => "open-1"),
}));
vi.mock("@/services/sftp", () => svc);
vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: vi.fn(async (c: Connection) => ({ username: c.username, password: "pw" })),
  resolveJumpHosts: vi.fn(async () => []),
}));
vi.mock("@/services/proxy", () => ({ resolveFirstHopProxy: vi.fn(async () => ({ kind: "direct" })) }));
vi.mock("@/utils/keepalive", () => ({ resolveKeepalive: () => ({ intervalSecs: 30, max: 3 }) }));
vi.mock("@/stores/connectivitySettingsStore", () => ({ getGlobalKeepalivePreset: () => "default" }));

const { connectFileBackend } = await import("./sftpTarget");

const conn = (over: Partial<Connection>): Connection =>
  ({ id: "c1", host: "h", port: 22, username: "u", auth_type: "password", tags: [], vault_id: "personal", created_at: "", updated_at: "", clocks: {}, ...over }) as Connection;

beforeEach(() => vi.clearAllMocks());

describe("connectFileBackend", () => {
  it("opens FTP hosts over ftpConnect", async () => {
    await expect(connectFileBackend(conn({ connection_type: "ftp", port: 21, ftp_secure: true }), "k")).resolves.toBe("ftp-1");
    expect(svc.ftpConnect).toHaveBeenCalledWith({ host: "h", port: 21, username: "u", password: "pw", secure: true });
  });

  it("opens WebDAV hosts with their URL, proxy and interactivity", async () => {
    const c = conn({ connection_type: "webdav", webdav_url: "https://h/dav/" });
    await expect(connectFileBackend(c, "k", true)).resolves.toBe("dav-1");
    expect(svc.webdavConnect).toHaveBeenCalledWith({
      connectId: "k", url: "https://h/dav/", username: "u", password: "pw", proxy: { kind: "direct" }, interactive: true,
    });
  });

  it("is non-interactive unless asked", async () => {
    await connectFileBackend(conn({ connection_type: "webdav", webdav_url: "https://h/dav/" }), "k");
    expect(svc.webdavConnect.mock.calls[0][0].interactive).toBe(false);
  });

  it("opens everything else over SFTP", async () => {
    await expect(connectFileBackend(conn({}), "k")).resolves.toBe("sftp-1");
    expect(svc.ftpConnect).not.toHaveBeenCalled();
    expect(svc.webdavConnect).not.toHaveBeenCalled();
  });
});
