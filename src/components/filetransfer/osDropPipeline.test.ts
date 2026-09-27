import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "./SFTPTypes";

const m = vi.hoisted(() => ({
  tar: false,
  sftpUploadBatchTar: vi.fn(async (_a: unknown) => {}),
  sftpDownloadBatchTar: vi.fn(async (_a: unknown) => {}),
  transferItem: vi.fn(async (_a: unknown) => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/sftp", () => ({
  sftpUploadBatchTar: m.sftpUploadBatchTar,
  sftpDownloadBatchTar: m.sftpDownloadBatchTar,
  sftpExists: vi.fn(async () => false),
  fsExists: vi.fn(async () => false),
}));
vi.mock("@/services/sftpTransferCore", () => ({ transferItem: m.transferItem }));
vi.mock("./tarSupport", () => ({ tarUsable: vi.fn(async () => m.tar) }));
vi.mock("@/stores/transferQueueStore", () => ({
  useTransferQueueStore: {
    getState: () => ({
      runTransfer: async (_label: string, _dir: string, fn: (tid: string) => Promise<void>) => fn("t1"),
      setPending: vi.fn(),
    }),
  },
}));

import { downloadToLocal, triggerUpload } from "./osDropPipeline";

const entry = (path: string, isDir = false): FileEntry =>
  ({ path, name: path.split(/[\\/]/).pop()!, isDir, size: 0 }) as FileEntry;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  m.tar = false;
});

// "C:" alone is the drive's current directory, not its root: trimming the
// separator off a picked drive root sent downloads somewhere else entirely.
describe("downloadToLocal", () => {
  it("keeps a picked drive root intact for a tar batch", async () => {
    m.tar = true;
    await downloadToLocal([entry("/r/a"), entry("/r/b")], "s1", "C:\\");
    expect(m.sftpDownloadBatchTar).toHaveBeenCalledWith(expect.objectContaining({ localDir: "C:\\" }));
  });

  it("joins each item under a drive root with one separator", async () => {
    await downloadToLocal([entry("/r/a.txt"), entry("/r/dir", true)], "s1", "C:\\");
    expect(m.transferItem.mock.calls.map(([a]) => (a as { dstPath: string }).dstPath)).toEqual(["C:\\a.txt", "C:\\dir"]);
    expect(m.transferItem).toHaveBeenCalledWith(expect.objectContaining({ from: "remote", to: "local", srcSftpId: "s1", isDir: true }));
  });

  it("joins under a POSIX root without doubling the slash", async () => {
    await downloadToLocal([entry("/r/a.txt")], "s1", "/");
    expect(m.transferItem).toHaveBeenCalledWith(expect.objectContaining({ dstPath: "/a.txt" }));
  });
});

describe("triggerUpload", () => {
  it("sends a batch into the remote root as \"/\", not an empty path", async () => {
    m.tar = true;
    await triggerUpload([entry("/l/a"), entry("/l/b")], { isLocal: false, sftpId: "s1", cwd: "/" });
    await flush();
    expect(m.sftpUploadBatchTar).toHaveBeenCalledWith(expect.objectContaining({ remoteDir: "/" }));
  });

  it("copies into a local drive root with Windows separators", async () => {
    await triggerUpload([entry("D:\\in\\a.txt")], { isLocal: true, sftpId: null, cwd: "C:\\" });
    await flush();
    expect(m.transferItem).toHaveBeenCalledWith(expect.objectContaining({ from: "local", to: "local", dstPath: "C:\\a.txt" }));
  });
});
