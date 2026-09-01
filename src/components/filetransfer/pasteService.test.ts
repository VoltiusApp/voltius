import { describe, it, expect, vi, beforeEach } from "vitest";
import { executePaste, buildPasteDeps, type PasteDeps } from "./pasteService";
import type { FileEntry } from "@/components/filetransfer/SFTPTypes";
import type { FileClipboard, FileEndpoint } from "@/stores/fileClipboardStore";
import { transferItem } from "@/services/sftpTransferCore";
import { tarUsableForPair } from "./tarSupport";

vi.mock("@/services/sftpTransferCore", () => ({ transferItem: vi.fn(async () => {}) }));
vi.mock("./tarSupport", () => ({ tarUsableForPair: vi.fn(async () => false) }));
vi.mock("@/services/sftp", () => ({
  fsExists: vi.fn(async () => false), sftpExists: vi.fn(async () => false),
  fsRename: vi.fn(async () => {}), sftpRename: vi.fn(async () => {}),
  fsDelete: vi.fn(async () => {}), sftpDelete: vi.fn(async () => {}),
}));

beforeEach(() => { vi.clearAllMocks(); });

const file = (path: string): FileEntry => ({ path, name: path.split("/").pop()!, isDir: false } as FileEntry);
const local = (cwd: string): FileEndpoint => ({ isLocal: true, sftpId: null, cwd });
const remote = (id: string, cwd: string): FileEndpoint => ({ isLocal: false, sftpId: id, cwd });

function mkDeps(overrides: Partial<PasteDeps> = {}): PasteDeps {
  return {
    existsInDest: vi.fn(async () => false),
    copyTarget: vi.fn(async () => {}),
    moveSameHost: vi.fn(async () => {}),
    deleteSource: vi.fn(async () => {}),
    setPending: vi.fn(),
    refresh: vi.fn(),
    clearClipboard: vi.fn(),
    ...overrides,
  };
}

describe("executePaste", () => {
  it("copy across folders keeps the original name when free", async () => {
    const clip: FileClipboard = { items: [file("/a/x.txt")], source: local("/a"), mode: "copy" };
    const deps = mkDeps();
    await executePaste(clip!, local("/b"), deps);
    expect(deps.copyTarget).toHaveBeenCalledWith(expect.objectContaining({ srcPath: "/a/x.txt", dstPath: "/b/x.txt" }));
    expect(deps.clearClipboard).not.toHaveBeenCalled(); // copy persists
  });

  it("copy into the same folder auto-renames to ' - Copy'", async () => {
    const clip: FileClipboard = { items: [file("/a/x.txt")], source: local("/a"), mode: "copy" };
    // original name is taken (same folder), the ' - Copy' variant is free
    const existsInDest = vi.fn(async (n: string) => n === "x.txt");
    const deps = mkDeps({ existsInDest });
    await executePaste(clip!, local("/a"), deps);
    expect(deps.copyTarget).toHaveBeenCalledWith(expect.objectContaining({ dstPath: "/a/x - Copy.txt" }));
  });

  it("same-host cut delegates to moveSameHost and does not clear the clipboard itself", async () => {
    const clip: FileClipboard = { items: [file("/a/x.txt")], source: local("/a"), mode: "cut" };
    const deps = mkDeps();
    await executePaste(clip!, local("/b"), deps);
    expect(deps.moveSameHost).toHaveBeenCalledWith(clip!.items, "/b");
    // clearing is deferred to moveSameHost's own completion (real dep clears on refresh)
    expect(deps.clearClipboard).not.toHaveBeenCalled();
  });

  it("cross-host cut copies then deletes source then clears", async () => {
    const clip: FileClipboard = { items: [file("/a/x.txt")], source: remote("s1", "/a"), mode: "cut" };
    const deps = mkDeps();
    await executePaste(clip!, local("/b"), deps);
    expect(deps.copyTarget).toHaveBeenCalledWith(expect.objectContaining({ dstPath: "/b/x.txt" }));
    expect(deps.deleteSource).toHaveBeenCalledWith("/a/x.txt");
    expect(deps.clearClipboard).toHaveBeenCalled();
  });

  it("cross-host cut: a failed copy keeps the source (no delete)", async () => {
    const clip: FileClipboard = { items: [file("/a/x.txt")], source: remote("s1", "/a"), mode: "cut" };
    const deps = mkDeps({ copyTarget: vi.fn(async () => { throw new Error("boom"); }) });
    await executePaste(clip!, local("/b"), deps);
    expect(deps.deleteSource).not.toHaveBeenCalled();
    expect(deps.clearClipboard).toHaveBeenCalled();
  });

  it("cross-host cut with a destination collision raises the conflict dialog", async () => {
    const clip: FileClipboard = { items: [file("/a/x.txt")], source: remote("s1", "/a"), mode: "cut" };
    const deps = mkDeps({ existsInDest: vi.fn(async () => true) });
    await executePaste(clip!, local("/b"), deps);
    expect(deps.setPending).toHaveBeenCalled();
    expect(deps.copyTarget).not.toHaveBeenCalled(); // deferred to the dialog's execute()
  });

  it("cut into the identical folder is a no-op", async () => {
    const clip: FileClipboard = { items: [file("/a/x.txt")], source: local("/a"), mode: "cut" };
    const deps = mkDeps();
    await executePaste(clip!, local("/a"), deps);
    expect(deps.moveSameHost).not.toHaveBeenCalled();
    expect(deps.copyTarget).not.toHaveBeenCalled();
  });
});

describe("buildPasteDeps", () => {
  const dir = (path: string): FileEntry => ({ path, name: path.split("/").pop()!, isDir: true } as FileEntry);

  const wiring = () => ({
    runTransfer: vi.fn(async (_l: string, _d: string, fn: (t: string) => Promise<void>, onDone?: () => void) => {
      await fn("t1");
      onDone?.();
    }),
    setPending: vi.fn(),
    refresh: vi.fn(),
    clearClipboard: vi.fn(),
  });

  const copyOne = async (source: FileEndpoint, dest: FileEndpoint, item: FileEntry) => {
    const w = wiring();
    const clip: FileClipboard = { items: [item], source, mode: "cut" };
    const deps = buildPasteDeps(clip, dest, w as never);
    await deps.copyTarget({ srcPath: item.path, dstPath: `${dest.cwd}/${item.name}`, isDir: item.isDir, name: item.name });
    return w;
  };

  it("tars a directory paste when the endpoint pair supports it", async () => {
    vi.mocked(tarUsableForPair).mockResolvedValue(true);
    const w = await copyOne(remote("s1", "/a"), local("/b"), dir("/a/saves"));
    expect(transferItem).toHaveBeenCalledWith(expect.objectContaining({ useTar: true }));
    expect(w.runTransfer).toHaveBeenCalledWith("saves", "→", expect.any(Function), expect.any(Function), true);
  });

  it("falls back to plain SFTP when the pair cannot tar", async () => {
    vi.mocked(tarUsableForPair).mockResolvedValue(false);
    const w = await copyOne(remote("s1", "/a"), local("/b"), dir("/a/saves"));
    expect(transferItem).toHaveBeenCalledWith(expect.objectContaining({ useTar: false }));
    expect(w.runTransfer).toHaveBeenCalledWith("saves", "→", expect.any(Function), expect.any(Function), false);
  });

  it("never flags a single file as accelerated", async () => {
    vi.mocked(tarUsableForPair).mockResolvedValue(true);
    const w = await copyOne(remote("s1", "/a"), local("/b"), file("/a/x.txt"));
    expect(w.runTransfer).toHaveBeenCalledWith("x.txt", "→", expect.any(Function), expect.any(Function), false);
  });
});
