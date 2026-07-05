import { describe, it, expect, vi } from "vitest";
import { executePaste, type PasteDeps } from "./pasteService";
import type { FileEntry } from "@/components/filetransfer/SFTPTypes";
import type { FileClipboard, FileEndpoint } from "@/stores/fileClipboardStore";

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
