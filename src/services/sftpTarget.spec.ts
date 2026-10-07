// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const sftpOpen = vi.fn();
const sftpConnect = vi.fn();
const ftpConnect = vi.fn();
const webdavConnect = vi.fn();
vi.mock("@/services/sftp", () => ({
  sftpOpen: (...a: unknown[]) => sftpOpen(...a),
  sftpConnect: (...a: unknown[]) => sftpConnect(...a),
  ftpConnect: (...a: unknown[]) => ftpConnect(...a),
  webdavConnect: (...a: unknown[]) => webdavConnect(...a),
}));
vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: vi.fn(async () => ({ username: "u", password: "p" })),
  resolveJumpHosts: vi.fn(async () => []),
  findConnection: vi.fn(() => undefined),
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

import { connectFileBackend, resolveSftpIdForTarget, sftpConnectToConnection } from "./sftpTarget";
import { useConnectivitySettingsStore } from "@/stores/connectivitySettingsStore";
import { getSecret } from "@/services/vault";
import type { Connection } from "@/types";

beforeEach(() => {
  for (const fn of [sftpOpen, sftpConnect, ftpConnect, webdavConnect]) fn.mockReset();
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

describe("connectFileBackend", () => {
  const conn = (over: Partial<Connection>) => ({ id: "c1", host: "h", port: 22, username: "u", ...over }) as Connection;

  it("opens FTP hosts over ftpConnect", async () => {
    ftpConnect.mockResolvedValue("ftp-1");
    await expect(connectFileBackend(conn({ connection_type: "ftp", port: 21, ftp_secure: true }), "k")).resolves.toBe("ftp-1");
    expect(ftpConnect).toHaveBeenCalledWith({ host: "h", port: 21, username: "u", password: "p", secure: true });
  });

  it("opens WebDAV hosts with their URL, proxy and interactivity", async () => {
    useConnectivitySettingsStore.setState({ proxy: { mode: "http", host: "p", port: 3128 } } as never);
    webdavConnect.mockResolvedValue("dav-1");
    const c = conn({ connection_type: "webdav", webdav_url: "https://h/dav/" });
    await expect(connectFileBackend(c, "k", true)).resolves.toBe("dav-1");
    expect(webdavConnect).toHaveBeenCalledWith({
      connectId: "k", url: "https://h/dav/", username: "u", password: "p", proxy: { kind: "http", host: "p", port: 3128 }, interactive: true,
    });
  });

  it("asks SFTP to reconnect into the lost session id", async () => {
    sftpConnect.mockResolvedValue("s1");
    await expect(connectFileBackend(conn({}), "k", true, "s1")).resolves.toBe("s1");
    expect(sftpConnect.mock.calls[0][0].relink).toBe("s1");
  });

  it("never relinks FTP or WebDAV", async () => {
    await connectFileBackend(conn({ connection_type: "ftp", port: 21 }), "k", true, "s1");
    await connectFileBackend(conn({ connection_type: "webdav", webdav_url: "https://h/" }), "k", true, "s1");
    expect(ftpConnect.mock.calls[0][0]).not.toHaveProperty("relink");
    expect(webdavConnect.mock.calls[0][0]).not.toHaveProperty("relink");
  });

  it("is non-interactive unless asked", async () => {
    await connectFileBackend(conn({ connection_type: "webdav", webdav_url: "https://h/dav/" }), "k");
    expect(webdavConnect.mock.calls[0][0].interactive).toBe(false);
  });

  it("opens everything else over SFTP", async () => {
    sftpConnect.mockResolvedValue("sftp-1");
    await expect(connectFileBackend(conn({}), "k")).resolves.toBe("sftp-1");
    expect(ftpConnect).not.toHaveBeenCalled();
    expect(webdavConnect).not.toHaveBeenCalled();
  });
});

describe("knock", () => {
  it("sends the resolved knock with the SFTP dial", async () => {
    vi.mocked(getSecret).mockResolvedValueOnce("7/tcp");
    sftpConnect.mockResolvedValue("sftp-k");
    await sftpConnectToConnection(
      { id: "k1", host: "h", port: 22, username: "u", auth_type: "password", tags: [], port_knock: { enabled: true } } as unknown as Connection,
      "k",
    );
    expect(sftpConnect.mock.calls[0][0].knock).toEqual({ steps: [{ port: 7, protocol: "tcp" }], delay_ms: 200, settle_ms: 500 });
  });
});
