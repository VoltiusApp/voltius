import { buildTransferTargets } from "./sftpTransferCore.ts";
import type { FileEntry } from "@/components/filetransfer/SFTPTypes";
import { describe, it, expect, vi, beforeEach, test } from "vitest";

test("sftpTransferCore", async () => {
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
}

const file = (name: string, isDir = false): FileEntry => ({ name, path: `/src/${name}`, size: 1, isDir, isSymlink: false });

{
  const out = buildTransferTargets([file("a.txt"), file("logs", true)], "/dest/");
  assertEqual(out, [
    { srcPath: "/src/a.txt", dstPath: "/dest/a.txt", isDir: false, name: "a.txt" },
    { srcPath: "/src/logs", dstPath: "/dest/logs", isDir: true, name: "logs" },
  ], "builds targets, joins paths, strips trailing slash");
}

{
  const out = buildTransferTargets([file("x")], "/");
  assertEqual(out[0].dstPath, "/x", "root dest joins without doubling slash");
}
});

// vi.mock factories are hoisted above imports/consts, so the mock object
// itself must be built inside vi.hoisted() to avoid a TDZ reference error.
const m = vi.hoisted(() => ({
  fsCopy: vi.fn(async () => {}),
  sftpUpload: vi.fn(async () => {}),
  sftpUploadDir: vi.fn(async () => {}),
  sftpUploadDirTar: vi.fn(async () => {}),
  sftpDownload: vi.fn(async () => {}),
  sftpDownloadDir: vi.fn(async () => {}),
  sftpDownloadDirTar: vi.fn(async () => {}),
  sftpTransfer: vi.fn(async () => {}),
  sftpTransferDir: vi.fn(async () => {}),
  sftpTransferDirTar: vi.fn(async () => {}),
}));
vi.mock("@/services/sftp", () => m);
const platform = vi.hoisted(() => ({ current: "linux" }));
vi.mock("@/utils/platform", () => ({ getPlatform: async () => platform.current }));

import { transferItem } from "./sftpTransferCore";

beforeEach(() => { Object.values(m).forEach((f) => f.mockClear()); platform.current = "linux"; });

describe("transferItem routing", () => {
  const base = { srcPath: "/s", dstPath: "/d", transferId: "t", useTar: true };

  it("local→local uses fsCopy", async () => {
    await transferItem({ ...base, from: "local", to: "local", isDir: false });
    expect(m.fsCopy).toHaveBeenCalledWith("/s", "/d", "t");
  });

  it("local→remote file uses sftpUpload", async () => {
    await transferItem({ ...base, from: "local", to: "remote", dstSftpId: "R", isDir: false });
    expect(m.sftpUpload).toHaveBeenCalledWith({ sftpId: "R", localPath: "/s", remotePath: "/d", transferId: "t" });
  });

  it("local→remote dir with tar uses sftpUploadDirTar", async () => {
    await transferItem({ ...base, from: "local", to: "remote", dstSftpId: "R", isDir: true });
    expect(m.sftpUploadDirTar).toHaveBeenCalledWith({ sftpId: "R", localPath: "/s", remotePath: "/d", transferId: "t" });
  });

  it("local→remote dir without tar uses sftpUploadDir", async () => {
    await transferItem({ ...base, useTar: false, from: "local", to: "remote", dstSftpId: "R", isDir: true });
    expect(m.sftpUploadDir).toHaveBeenCalledWith({ sftpId: "R", localPath: "/s", remotePath: "/d", transferId: "t" });
  });

  it("remote→local file uses sftpDownload", async () => {
    await transferItem({ ...base, from: "remote", to: "local", srcSftpId: "R", isDir: false });
    expect(m.sftpDownload).toHaveBeenCalledWith({ sftpId: "R", remotePath: "/s", localPath: "/d", transferId: "t" });
  });

  it("remote→remote dir with tar uses sftpTransferDirTar with both channels", async () => {
    await transferItem({ ...base, from: "remote", to: "remote", srcSftpId: "A", dstSftpId: "B", isDir: true });
    expect(m.sftpTransferDirTar).toHaveBeenCalledWith({ srcSftpId: "A", srcPath: "/s", dstSftpId: "B", dstPath: "/d", transferId: "t" });
  });

  it("refuses a server name the local system reads as a path", async () => {
    platform.current = "windows";
    const down = { ...base, from: "remote", to: "local", srcSftpId: "R", isDir: false } as const;
    await expect(transferItem({ ...down, srcPath: "/r/..\\..\\x", dstPath: "C:\\dl\\..\\..\\x" })).rejects.toThrow("Refusing unsafe file name");
    await expect(transferItem({ ...down, srcPath: "/r/C:x", isDir: true })).rejects.toThrow("Refusing unsafe file name");
    expect(m.sftpDownload).not.toHaveBeenCalled();
    expect(m.sftpDownloadDirTar).not.toHaveBeenCalled();
    platform.current = "linux";
    await transferItem({ ...down, srcPath: "/r/a\\b", dstPath: "/dl/a\\b" });
    expect(m.sftpDownload).toHaveBeenCalledTimes(1);
  });

  it("downloads a remote directory given with a trailing slash", async () => {
    await transferItem({ ...base, from: "remote", to: "local", srcSftpId: "R", srcPath: "/var/log/", isDir: true });
    expect(m.sftpDownloadDirTar).toHaveBeenCalled();
  });

  it("throws when a required remote channel is missing", async () => {
    await expect(transferItem({ ...base, from: "local", to: "remote", isDir: false })).rejects.toThrow();
  });
});
