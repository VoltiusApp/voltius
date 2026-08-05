import { test, expect, vi } from "vitest";
import { pasteFromClipboard, type ClipboardAdapter } from "./vaultClipboard";
import type { VaultClipboard } from "@/stores/vaultClipboardStore";

function adapter(over: Partial<ClipboardAdapter> = {}): ClipboardAdapter {
  return {
    navItem: "hosts",
    exists: () => true,
    vaultIdOf: () => "personal",
    targetFolderId: () => "dest",
    targetVaultId: () => "personal",
    folderIdOf: () => null,
    moveItems: vi.fn(async () => {}),
    moveFolder: vi.fn(async () => {}),
    duplicateItems: vi.fn(async (ids: string[]) => ids.map((i) => `${i}-copy`)),
    duplicateFolder: vi.fn(async (id: string) => `${id}-copy`),
    deleteItems: vi.fn(async () => {}),
    deleteFolder: vi.fn(async () => {}),
    setSelection: vi.fn(),
    ...over,
  };
}

const cut: VaultClipboard = {
  tab: "hosts", mode: "cut",
  items: [{ id: "c1", kind: "connection" }], folderIds: [], sourceVaultIds: ["personal"],
};

test("cut paste moves items into the target folder", async () => {
  const a = adapter();
  const r = await pasteFromClipboard(cut, a);
  expect(a.moveItems).toHaveBeenCalledWith(["c1"], "dest");
  expect(r).toMatchObject({ moved: 1, created: 0, skipped: 0 });
});

test("copy paste duplicates and selects the new ids", async () => {
  const a = adapter();
  const r = await pasteFromClipboard({ ...cut, mode: "copy" }, a);
  expect(a.duplicateItems).toHaveBeenCalledWith(["c1"], "dest");
  expect(a.setSelection).toHaveBeenCalledWith(["c1-copy"]);
  expect(r).toMatchObject({ moved: 0, created: 1 });
});

test("stale ids are skipped, the rest still land", async () => {
  const a = adapter({ exists: (id) => id !== "gone" });
  const r = await pasteFromClipboard(
    { ...cut, items: [{ id: "c1", kind: "connection" }, { id: "gone", kind: "connection" }] },
    a,
  );
  expect(a.moveItems).toHaveBeenCalledWith(["c1"], "dest");
  expect(r.skipped).toBe(1);
});

test("a clipboard of only stale ids mutates nothing", async () => {
  const a = adapter({ exists: () => false });
  const r = await pasteFromClipboard(cut, a);
  expect(a.moveItems).not.toHaveBeenCalled();
  expect(r).toMatchObject({ moved: 0, created: 0, skipped: 1 });
});

test("cut into the folder the items already occupy is a no-op", async () => {
  const a = adapter({ folderIdOf: () => "dest" });
  const r = await pasteFromClipboard(cut, a);
  expect(a.moveItems).not.toHaveBeenCalled();
  expect(r.moved).toBe(0);
});

test("a null clipboard does nothing", async () => {
  const a = adapter();
  const r = await pasteFromClipboard(null, a);
  expect(a.moveItems).not.toHaveBeenCalled();
  expect(r).toMatchObject({ moved: 0, created: 0, skipped: 0 });
});

test("a clipboard from another tab is ignored", async () => {
  const a = adapter({ navItem: "snippets" });
  const r = await pasteFromClipboard(cut, a);
  expect(a.moveItems).not.toHaveBeenCalled();
  expect(r).toMatchObject({ moved: 0, created: 0 });
});

test("copy paste of a folder clones the subtree", async () => {
  const a = adapter();
  const r = await pasteFromClipboard(
    { tab: "hosts", mode: "copy", items: [], folderIds: ["f1"], sourceVaultIds: ["personal"] },
    a,
  );
  expect(a.duplicateFolder).toHaveBeenCalledWith("f1", "dest");
  expect(r.created).toBe(1);
});

import { useHistoryStore } from "@/stores/historyStore";

test("a multi-item paste pushes exactly one history entry", async () => {
  useHistoryStore.setState({ past: [], future: [], canUndo: false, canRedo: false });
  const a = adapter({ folderIdOf: () => "old" });
  await pasteFromClipboard(
    { tab: "hosts", mode: "cut", items: [
      { id: "c1", kind: "connection" }, { id: "c2", kind: "connection" }, { id: "c3", kind: "connection" },
    ], folderIds: [], sourceVaultIds: ["personal"] },
    a,
  );
  expect(useHistoryStore.getState().past).toHaveLength(1);
});

test("undoing a cut paste returns every item to its original folder", async () => {
  useHistoryStore.setState({ past: [], future: [], canUndo: false, canRedo: false });
  const origin: Record<string, string | null> = { c1: "f1", c2: null };
  const a = adapter({ folderIdOf: (id) => origin[id] ?? null });
  await pasteFromClipboard(
    { tab: "hosts", mode: "cut", items: [
      { id: "c1", kind: "connection" }, { id: "c2", kind: "connection" },
    ], folderIds: [], sourceVaultIds: ["personal"] },
    a,
  );
  await useHistoryStore.getState().undo();
  expect(a.moveItems).toHaveBeenCalledWith(["c1"], "f1");
  expect(a.moveItems).toHaveBeenCalledWith(["c2"], null);
});

test("undoing a copy paste deletes exactly what it created", async () => {
  useHistoryStore.setState({ past: [], future: [], canUndo: false, canRedo: false });
  const a = adapter();
  await pasteFromClipboard(
    { tab: "hosts", mode: "copy", items: [{ id: "c1", kind: "connection" }], folderIds: ["f1"], sourceVaultIds: ["personal"] },
    a,
  );
  await useHistoryStore.getState().undo();
  expect(a.deleteItems).toHaveBeenCalledWith(["c1-copy"]);
  expect(a.deleteFolder).toHaveBeenCalledWith("f1-copy");
});

test("a no-op paste pushes no history entry", async () => {
  useHistoryStore.setState({ past: [], future: [], canUndo: false, canRedo: false });
  await pasteFromClipboard(null, adapter());
  expect(useHistoryStore.getState().past).toHaveLength(0);
});
