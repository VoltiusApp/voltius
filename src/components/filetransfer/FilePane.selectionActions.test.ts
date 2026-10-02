import { describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import { buildSelectionActions } from "./FilePane";
import type { FileEntry } from "./SFTPTypes";

const t = ((key: string) => key) as unknown as TFunction;
const file = (name: string): FileEntry => ({ name, path: `/d/${name}`, size: 1, isDir: false });

const labels = (canArchive: boolean, entry: FileEntry) =>
  buildSelectionActions([entry], {
    isLocal: false, sftpId: "s1", hostLabel: "h", canTransferToTarget: false,
    onStartRename: vi.fn(), onDelete: vi.fn(), onCompress: vi.fn(), onExtract: vi.fn(),
    canArchive, setSelection: vi.fn(), onRefresh: vi.fn(),
  }, t).map((item) => item.label);

describe("buildSelectionActions", () => {
  it("offers Compress and Extract only where tar can run", () => {
    expect(labels(true, file("a.tar.gz"))).toEqual(expect.arrayContaining([
      "fileTransfer.pane.menu.compress", "fileTransfer.pane.menu.extractHere",
    ]));
    const without = labels(false, file("a.tar.gz"));
    expect(without).not.toContain("fileTransfer.pane.menu.compress");
    expect(without).not.toContain("fileTransfer.pane.menu.extractHere");
  });
});
