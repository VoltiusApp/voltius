// @vitest-environment jsdom
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

const writeLabels = ["common.action.rename", "fileTransfer.pane.menu.delete", "fileTransfer.pane.menu.compress"];

describe("buildSelectionActions on a read-only device", () => {
  const build = (readOnlyTip?: string) =>
    buildSelectionActions([file("a.txt")], {
      isLocal: false, sftpId: "s1", hostLabel: "h", canTransferToTarget: true,
      onStartRename: vi.fn(), onDelete: vi.fn(), onCompress: vi.fn(), onExtract: vi.fn(),
      canArchive: true, setSelection: vi.fn(), onRefresh: vi.fn(), readOnlyTip,
    }, t);

  it("disables every write with the tip", () => {
    const items = build("shared read-only");
    for (const label of [...writeLabels, "fileTransfer.pane.menu.moveToTarget"]) {
      expect(items.find((i) => i.label === label)?.disabledReason).toBe("shared read-only");
    }
    expect(items.find((i) => i.label === "common.action.edit")?.disabledReason).toBeUndefined();
  });

  it("leaves them enabled otherwise", () => {
    expect(build().every((i) => i.disabledReason === undefined)).toBe(true);
  });
});

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
