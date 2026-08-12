import { describe, it, expect, vi, beforeEach } from "vitest";

const svc = vi.hoisted(() => ({
  sftpConnect: vi.fn(async () => "sftp-1"),
  ftpConnect: vi.fn(async () => "ftp-1"),
  sftpClose: vi.fn(async () => {}),
  sftpListDir: vi.fn(async () => [
    { name: "a.txt", path: "/srv/a.txt", size: 3, is_dir: false, is_symlink: false, modified: 1 },
    { name: "sub", path: "/srv/sub", size: 0, is_dir: true, is_symlink: false, modified: 2 },
  ]),
  sftpMkdir: vi.fn(async () => {}),
  sftpRename: vi.fn(async () => {}),
  sftpDelete: vi.fn(async () => {}),
  sftpReadFile: vi.fn(async () => ({ content: "hello" })),
  sftpWriteFile: vi.fn(async () => {}),
  sftpUpload: vi.fn(async () => {}),
  sftpUploadDir: vi.fn(async () => {}),
  sftpDownload: vi.fn(async () => {}),
  sftpDownloadDir: vi.fn(async () => {}),
  sftpTransfer: vi.fn(async () => {}),
  sftpTransferDir: vi.fn(async () => {}),
  fsListDir: vi.fn(async () => [
    { name: "a.txt", path: "/home/u/a.txt", size: 3, is_dir: false, modified: 1 },
  ]),
  fsMkdir: vi.fn(async () => {}),
  fsRename: vi.fn(async () => {}),
  fsDelete: vi.fn(async () => {}),
  fsCopy: vi.fn(async () => {}),
  fsReadFile: vi.fn(async () => ({ content: "local" })),
}));
vi.mock("@/services/sftp", () => svc);
vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: vi.fn(async () => ({ username: "u", password: "p" })),
  resolveJumpHosts: vi.fn(async () => []),
}));
vi.mock("@/utils/keepalive", () => ({ resolveKeepalive: () => ({ intervalSecs: 30, max: 3 }) }));
vi.mock("@/stores/connectivitySettingsStore", () => ({ getGlobalKeepalivePreset: () => "default" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/path", () => ({ appCacheDir: vi.fn(async () => "/cache") }));

import { createSftpAPI } from "./sftp";

const SSH = { id: "c-ssh", host: "h", port: 22, username: "u" } as never;
const FTP = { id: "c-ftp", host: "f", port: 21, username: "u", connection_type: "ftp" } as never;
const SSH2 = { id: "c-ssh2", host: "h2", port: 22, username: "u" } as never;
const find = (id: string) =>
  id === "c-ssh" ? SSH : id === "c-ssh2" ? SSH2 : id === "c-ftp" ? FTP : undefined;

beforeEach(() => vi.clearAllMocks());

describe("createSftpAPI", () => {
  it("opens an FTP connection over ftpConnect and an SSH one over sftpConnect", async () => {
    const api = createSftpAPI(find);
    await api.list("c-ftp", "/");
    expect(svc.ftpConnect).toHaveBeenCalledTimes(1);
    expect(svc.sftpConnect).not.toHaveBeenCalled();

    await api.list("c-ssh", "/");
    expect(svc.sftpConnect).toHaveBeenCalledTimes(1);
  });

  it("reuses one handle per target across calls", async () => {
    const api = createSftpAPI(find);
    await api.list("c-ssh", "/a");
    await api.list("c-ssh", "/b");
    await api.mkdir("c-ssh", "/c");
    expect(svc.sftpConnect).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed open, so a transient failure cannot poison the target", async () => {
    svc.sftpConnect.mockRejectedValueOnce(new Error("refused"));
    const api = createSftpAPI(find);
    await expect(api.list("c-ssh", "/")).rejects.toThrow("refused");
    await expect(api.list("c-ssh", "/")).resolves.toHaveLength(2);
    expect(svc.sftpConnect).toHaveBeenCalledTimes(2);
  });

  it("routes the local target to the fs_* helpers, never opening a connection", async () => {
    const api = createSftpAPI(find);
    await api.list("local", "/home/u");
    await api.mkdir("local", "/home/u/x");
    await api.delete("local", "/home/u/y");
    expect(svc.fsListDir).toHaveBeenCalledWith("/home/u");
    expect(svc.fsMkdir).toHaveBeenCalledWith("/home/u/x");
    expect(svc.fsDelete).toHaveBeenCalledWith("/home/u/y");
    expect(svc.sftpConnect).not.toHaveBeenCalled();
  });

  it("stat reports is_dir from the parent listing, and null for a missing entry", async () => {
    const api = createSftpAPI(find);
    await expect(api.stat("c-ssh", "/srv/sub")).resolves.toMatchObject({ isDir: true });
    await expect(api.stat("c-ssh", "/srv/a.txt")).resolves.toMatchObject({ isDir: false, size: 3 });
    await expect(api.stat("c-ssh", "/srv/nope")).resolves.toBeNull();
  });

  it.each([
    ["local→remote file", { target: "local", path: "/home/u/a.txt" }, { target: "c-ssh", path: "/srv/a.txt" }, "sftpUpload"],
    ["remote→local file", { target: "c-ssh", path: "/srv/a.txt" }, { target: "local", path: "/home/u/a.txt" }, "sftpDownload"],
    ["local→local file", { target: "local", path: "/home/u/a.txt" }, { target: "local", path: "/home/u/b.txt" }, "fsCopy"],
  ])("transfer picks %s", async (_label, src, dst, expected) => {
    const api = createSftpAPI(find);
    await api.transfer(src, dst);
    expect(svc[expected as keyof typeof svc]).toHaveBeenCalledTimes(1);
  });

  it("transfers host→host directly, without routing through this machine", async () => {
    const api = createSftpAPI(find);
    await api.transfer({ target: "c-ssh", path: "/srv/a.txt" }, { target: "c-ssh2", path: "/srv/b.txt" });
    expect(svc.sftpTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ srcSftpId: "sftp-1", srcPath: "/srv/a.txt", dstSftpId: "sftp-1", dstPath: "/srv/b.txt" }),
    );
    expect(svc.sftpDownload).not.toHaveBeenCalled();
    expect(svc.sftpUpload).not.toHaveBeenCalled();
  });

  it("uses the directory variant when the source is a directory", async () => {
    const api = createSftpAPI(find);
    await api.transfer({ target: "c-ssh", path: "/srv/sub" }, { target: "c-ssh2", path: "/srv/sub2" });
    expect(svc.sftpTransferDir).toHaveBeenCalledTimes(1);
    expect(svc.sftpTransfer).not.toHaveBeenCalled();
  });

  it("refuses a transfer whose source does not exist rather than creating an empty one", async () => {
    const api = createSftpAPI(find);
    await expect(
      api.transfer({ target: "c-ssh", path: "/srv/nope" }, { target: "local", path: "/home/u/x" }),
    ).rejects.toThrow(/No such path/);
    expect(svc.sftpDownload).not.toHaveBeenCalled();
  });

  // An FTP end used to be staged through this machine's cache directory,
  // because sftp_transfer resolved both ids with get_session and an FTP backend
  // is not a real SFTP session. It now pipes backend-to-backend in Rust.
  it.each([
    ["ssh→ftp", { target: "c-ssh", path: "/srv/a.txt" }, { target: "c-ftp", path: "/pub/a.txt" }, "sftp-1", "ftp-1"],
    ["ftp→ssh", { target: "c-ftp", path: "/pub/a.txt" }, { target: "c-ssh", path: "/srv/a.txt" }, "ftp-1", "sftp-1"],
  ])("transfers %s directly, staging nothing on this machine", async (_n, src, dst, srcId, dstId) => {
    const api = createSftpAPI(find);
    await api.transfer(src, dst);
    expect(svc.sftpTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ srcSftpId: srcId, srcPath: src.path, dstSftpId: dstId, dstPath: dst.path }),
    );
    expect(svc.sftpDownload).not.toHaveBeenCalled();
    expect(svc.sftpUpload).not.toHaveBeenCalled();
    expect(svc.fsDelete).not.toHaveBeenCalled();
  });

  it("mints its own transfer id when the caller supplies none, unaffected by the new optional parameter", async () => {
    const api = createSftpAPI(find);
    await api.transfer({ target: "local", path: "/home/u/a.txt" }, { target: "c-ssh", path: "/srv/a.txt" });
    expect(svc.sftpUpload).toHaveBeenCalledWith(
      expect.objectContaining({ transferId: expect.stringMatching(/.+/) }),
    );
  });

  it("uses the caller-supplied transfer id instead of minting one, so progress lands on the caller's own subscription", async () => {
    const api = createSftpAPI(find);
    await api.transfer(
      { target: "local", path: "/home/u/a.txt" },
      { target: "c-ssh", path: "/srv/a.txt" },
      "queue-row-42",
    );
    expect(svc.sftpUpload).toHaveBeenCalledWith(expect.objectContaining({ transferId: "queue-row-42" }));
  });

  it("dispose closes every open handle so an unloaded plugin leaves no connections", async () => {
    const api = createSftpAPI(find);
    await api.list("c-ssh", "/");
    await api.list("c-ftp", "/");
    api.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(svc.sftpClose).toHaveBeenCalledTimes(2);
  });

  // A model reaching for a hostname instead of the opaque id is the common
  // failure; it must name the target, not blame the path.
  it.each([
    ["list", (a: ReturnType<typeof createSftpAPI>) => a.list("172.20.0.4", "/")],
    ["stat", (a: ReturnType<typeof createSftpAPI>) => a.stat("172.20.0.4", "/x")],
    ["delete", (a: ReturnType<typeof createSftpAPI>) => a.delete("172.20.0.4", "/x")],
    ["transfer", (a: ReturnType<typeof createSftpAPI>) =>
      a.transfer({ target: "172.20.0.4", path: "/x" }, { target: "local", path: "/y" })],
  ])("%s names an unresolvable target rather than failing vaguely", async (_n, call) => {
    const api = createSftpAPI(find);
    await expect(call(api)).rejects.toThrow(/Unknown file target "172\.20\.0\.4"/);
    expect(svc.sftpConnect).not.toHaveBeenCalled();
  });
});
