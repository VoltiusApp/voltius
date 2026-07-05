import { describe, it, expect, beforeEach } from "vitest";
import { useFileClipboardStore, sameHost } from "./fileClipboardStore";
import type { FileEntry } from "@/components/filetransfer/SFTPTypes";

const entry = (path: string): FileEntry =>
  ({ path, name: path.split("/").pop()!, isDir: false } as FileEntry);

describe("fileClipboardStore", () => {
  beforeEach(() => useFileClipboardStore.getState().clear());

  it("stores and clears a clipboard snapshot", () => {
    useFileClipboardStore.getState().set({
      items: [entry("/a/x.txt")],
      source: { isLocal: true, sftpId: null, cwd: "/a" },
      mode: "copy",
    });
    expect(useFileClipboardStore.getState().clipboard?.mode).toBe("copy");
    useFileClipboardStore.getState().clear();
    expect(useFileClipboardStore.getState().clipboard).toBeNull();
  });

  it("sameHost compares isLocal + sftpId, ignoring cwd", () => {
    expect(sameHost({ isLocal: true, sftpId: null, cwd: "/a" }, { isLocal: true, sftpId: null, cwd: "/b" })).toBe(true);
    expect(sameHost({ isLocal: false, sftpId: "s1", cwd: "/a" }, { isLocal: false, sftpId: "s1", cwd: "/z" })).toBe(true);
    expect(sameHost({ isLocal: false, sftpId: "s1", cwd: "/a" }, { isLocal: false, sftpId: "s2", cwd: "/a" })).toBe(false);
    expect(sameHost({ isLocal: true, sftpId: null, cwd: "/a" }, { isLocal: false, sftpId: "s1", cwd: "/a" })).toBe(false);
  });
});
