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
    folderContentKinds: () => [],
    canMoveFolder: () => true,
    moveItems: vi.fn(async () => {}),
    moveFolder: vi.fn(async () => {}),
    duplicateItems: vi.fn(async (ids: string[]) => ids.map((i) => `${i}-copy`)),
    duplicateFolder: vi.fn(async (id: string) => `${id}-copy`),
    deleteItems: vi.fn(async () => {}),
    deleteFolder: vi.fn(async () => {}),
    setSelection: vi.fn(),
    can: () => true,
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
  expect(a.moveItems).toHaveBeenCalledWith(["c1"], "dest", "personal");
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
  expect(a.moveItems).toHaveBeenCalledWith(["c1"], "dest", "personal");
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

const noop = async () => {};

test("entries pushed by the store methods a paste calls are suppressed", async () => {
  useHistoryStore.setState({ past: [], future: [], canUndo: false, canRedo: false });
  const push = () => useHistoryStore.getState().push({ label: "store", undo: noop, redo: noop });
  const a = adapter({
    folderIdOf: () => "old",
    moveItems: vi.fn(async () => { push(); }),
    moveFolder: vi.fn(async () => { push(); }),
  });
  await pasteFromClipboard(
    { tab: "hosts", mode: "cut", items: [{ id: "c1", kind: "connection" }], folderIds: ["f1"], sourceVaultIds: ["personal"] },
    a,
  );
  const { past } = useHistoryStore.getState();
  expect(past).toHaveLength(1);
  expect(past[0].label).not.toBe("store");
});

test("suppression also covers the duplicates a copy paste creates", async () => {
  useHistoryStore.setState({ past: [], future: [], canUndo: false, canRedo: false });
  const a = adapter({
    duplicateItems: vi.fn(async (ids: string[]) => {
      useHistoryStore.getState().push({ label: "store", undo: noop, redo: noop });
      return ids.map((i) => `${i}-copy`);
    }),
  });
  await pasteFromClipboard({ ...cut, mode: "copy" }, a);
  expect(useHistoryStore.getState().past).toHaveLength(1);
});

test("suppression is lifted once the paste returns", async () => {
  useHistoryStore.setState({ past: [], future: [], canUndo: false, canRedo: false });
  await pasteFromClipboard({ ...cut, mode: "copy" }, adapter());
  useHistoryStore.getState().push({ label: "later", undo: noop, redo: noop });
  expect(useHistoryStore.getState().past).toHaveLength(2);
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
  expect(a.moveItems).toHaveBeenCalledWith(["c1"], "f1", "personal");
  expect(a.moveItems).toHaveBeenCalledWith(["c2"], null, "personal");
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

// A redo re-creates under fresh ids. If the entry kept holding the first clone's
// ids, the second undo would delete already-deleted objects and leave the redone
// ones behind — only ever verified by reading until now.
test("a second undo after a redo deletes what the redo created", async () => {
  useHistoryStore.setState({
    past: [], future: [], bypassing: false, suppressing: false, suppressDepth: 0,
    canUndo: false, canRedo: false,
  });
  let round = 0;
  const a = adapter({
    duplicateItems: vi.fn(async (ids: string[]) => ids.map((i) => `${i}-copy${round}`)),
    duplicateFolder: vi.fn(async (id: string) => `${id}-copy${round}`),
  });
  await pasteFromClipboard(
    { tab: "hosts", mode: "copy", items: [{ id: "c1", kind: "connection" }], folderIds: ["f1"], sourceVaultIds: ["personal"] },
    a,
  );

  await useHistoryStore.getState().undo();
  expect(a.deleteItems).toHaveBeenLastCalledWith(["c1-copy0"]);
  expect(a.deleteFolder).toHaveBeenLastCalledWith("f1-copy0");

  round = 1;
  await useHistoryStore.getState().redo();
  expect(a.duplicateItems).toHaveBeenCalledTimes(2);
  expect(a.duplicateFolder).toHaveBeenLastCalledWith("f1", "dest");

  await useHistoryStore.getState().undo();
  expect(a.deleteItems).toHaveBeenLastCalledWith(["c1-copy1"]);
  expect(a.deleteFolder).toHaveBeenLastCalledWith("f1-copy1");
  expect(useHistoryStore.getState().canRedo).toBe(true);
});

test("undoing a cross-vault cut restores the vault each item came from", async () => {
  useHistoryStore.setState({ past: [], future: [], canUndo: false, canRedo: false });
  // Origin is the vault root, so no origin folder carries the original vault.
  const a = adapter({ targetVaultId: () => "team-1", vaultIdOf: () => "personal" });
  await pasteFromClipboard(cut, a);
  expect(a.moveItems).toHaveBeenCalledWith(["c1"], "dest", "team-1");

  await useHistoryStore.getState().undo();
  expect(a.moveItems).toHaveBeenCalledWith(["c1"], null, "personal");
});

test("undoing a folder cut restores its parent and its vault", async () => {
  useHistoryStore.setState({ past: [], future: [], canUndo: false, canRedo: false });
  const a = adapter({
    targetVaultId: () => "team-1",
    vaultIdOf: () => "personal",
    folderIdOf: () => "parent",
  });
  await pasteFromClipboard(
    { tab: "hosts", mode: "cut", items: [], folderIds: ["f1"], sourceVaultIds: ["personal"] },
    a,
  );
  await useHistoryStore.getState().undo();
  expect(a.moveFolder).toHaveBeenCalledWith("f1", "parent", "personal");
});

test("a paste at the root passes a null vault so nothing migrates", async () => {
  const a = adapter({ targetVaultId: () => null, folderIdOf: () => "old" });
  await pasteFromClipboard(cut, a);
  expect(a.moveItems).toHaveBeenCalledWith(["c1"], "dest", null);
});

test("a no-op paste pushes no history entry", async () => {
  useHistoryStore.setState({ past: [], future: [], canUndo: false, canRedo: false });
  await pasteFromClipboard(null, adapter());
  expect(useHistoryStore.getState().past).toHaveLength(0);
});

const EDIT = "EDIT_CONNECTIONS";

test("a cross-vault paste without destination edit permission mutates nothing", async () => {
  const a = adapter({
    targetVaultId: () => "team-1",
    vaultIdOf: () => "personal",
    can: (_p, vaultId) => vaultId !== "team-1",
  });
  const r = await pasteFromClipboard({ ...cut, mode: "copy" }, a);
  expect(a.duplicateItems).not.toHaveBeenCalled();
  expect(r.blocked).toContain(EDIT);
  expect(r.created).toBe(0);
});

test("a cross-vault cut without source edit permission mutates nothing", async () => {
  const a = adapter({
    targetVaultId: () => "personal",
    vaultIdOf: () => "team-1",
    can: (_p, vaultId) => vaultId !== "team-1",
  });
  const r = await pasteFromClipboard(cut, a);
  expect(a.moveItems).not.toHaveBeenCalled();
  expect(r.blocked).toContain(EDIT);
});

test("a same-vault paste needs no cross-vault permission check", async () => {
  const can = vi.fn(() => true);
  const a = adapter({ can, folderIdOf: () => "old" });
  const r = await pasteFromClipboard(cut, a);
  expect(r.moved).toBe(1);
});
