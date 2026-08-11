import { test, expect, vi } from "vitest";
import { pasteFromClipboard, runPaste, type ClipboardAdapter } from "./vaultClipboard";
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

function resetHistory() {
  useHistoryStore.setState({
    past: [], future: [], bypassing: false, suppressing: false, suppressDepth: 0,
    canUndo: false, canRedo: false,
  });
}

// A cut from team-1 into team-2, undone once the permission on one side is gone.
// The undo is its own cross-vault move: team-2 is now the source, team-1 the
// destination, and half-applying it leaves the object in both vaults.
async function crossVaultCut() {
  resetHistory();
  const vaults: Record<string, string> = { c1: "team-1" };
  // Revoked after the paste, the way an owner revokes a permission after the fact.
  const revoked = { vaultId: null as string | null };
  const a = adapter({
    targetVaultId: () => "team-2",
    vaultIdOf: (id) => vaults[id] ?? "team-1",
    moveItems: vi.fn(async (ids: string[], _folderId, vaultId) => {
      for (const id of ids) if (vaultId) vaults[id] = vaultId;
    }),
    can: (_p, vaultId) => vaultId !== revoked.vaultId,
  });
  await pasteFromClipboard(cut, a);
  (a.moveItems as ReturnType<typeof vi.fn>).mockClear();
  return { a, revoked };
}

test("undo of a cross-vault cut is refused when the undo's source permission is gone", async () => {
  // team-2 holds the item after the paste, so it is the source of the undo.
  const { a, revoked } = await crossVaultCut();
  revoked.vaultId = "team-2";
  await useHistoryStore.getState().undo();
  expect(a.moveItems).not.toHaveBeenCalled();
});

test("undo of a cross-vault cut is refused when the undo's destination permission is gone", async () => {
  const { a, revoked } = await crossVaultCut();
  revoked.vaultId = "team-1";
  await useHistoryStore.getState().undo();
  expect(a.moveItems).not.toHaveBeenCalled();
});

test("a refused undo throws, so the entry is restored and stays retriable", async () => {
  const { revoked } = await crossVaultCut();
  revoked.vaultId = "team-2";
  await useHistoryStore.getState().undo();
  const { past, future, canUndo } = useHistoryStore.getState();
  expect(past).toHaveLength(1);
  expect(future).toHaveLength(0);
  expect(canUndo).toBe(true);
});

test("redo of a cross-vault cut is refused when a permission is gone", async () => {
  const { a, revoked } = await crossVaultCut();
  await useHistoryStore.getState().undo();
  expect(a.moveItems).toHaveBeenCalledWith(["c1"], null, "team-1");
  (a.moveItems as ReturnType<typeof vi.fn>).mockClear();

  revoked.vaultId = "team-2";
  await useHistoryStore.getState().redo();
  expect(a.moveItems).not.toHaveBeenCalled();
  expect(useHistoryStore.getState().canRedo).toBe(true);
});

test("a cross-vault undo with full permissions still moves everything back", async () => {
  const { a } = await crossVaultCut();
  await useHistoryStore.getState().undo();
  expect(a.moveItems).toHaveBeenCalledWith(["c1"], null, "team-1");
  expect(useHistoryStore.getState().canRedo).toBe(true);
});

test("undo of a copy paste is refused when the destination vault permission is gone", async () => {
  resetHistory();
  const revoked = { vaultId: null as string | null };
  const a = adapter({
    targetVaultId: () => "team-2",
    vaultIdOf: (id) => (id.endsWith("-copy") ? "team-2" : "team-1"),
    can: (_p, vaultId) => vaultId !== revoked.vaultId,
  });
  await pasteFromClipboard({ ...cut, mode: "copy" }, a);
  revoked.vaultId = "team-2";
  await useHistoryStore.getState().undo();
  expect(a.deleteItems).not.toHaveBeenCalled();
  expect(useHistoryStore.getState().canUndo).toBe(true);
});

test("a same-vault paste needs no cross-vault permission check", async () => {
  const can = vi.fn(() => true);
  const a = adapter({ can, folderIdOf: () => "old" });
  const r = await pasteFromClipboard(cut, a);
  expect(r.moved).toBe(1);
});

// A cut from a team vault root, pasted at a root that only shows Personal: the
// object keeps its vault, so nothing moves and nothing used to be said.
test("a root paste that would have to change vault reports itself", async () => {
  const a = adapter({
    targetFolderId: () => null,
    targetVaultId: () => null,
    folderIdOf: () => null,
    vaultIdOf: () => "team-1",
    rootVaultIds: () => ["personal"],
  });
  const r = await pasteFromClipboard(cut, a);
  expect(a.moveItems).not.toHaveBeenCalled();
  expect(r).toMatchObject({ moved: 0, crossVaultAtRoot: true });
});

test("a root paste of an object already in a shown vault stays silent", async () => {
  const a = adapter({
    targetFolderId: () => null,
    targetVaultId: () => null,
    folderIdOf: () => null,
    vaultIdOf: () => "personal",
    rootVaultIds: () => ["personal"],
  });
  const r = await pasteFromClipboard(cut, a);
  expect(r.crossVaultAtRoot).toBeFalsy();
});

// The source vault only loses what the folder actually contains. Merely-referenced
// kinds belong to `danglingKinds`, so demanding them of the source would refuse a
// move over objects it never touches.
test("the source check covers folder contents, not kinds the folder only references", async () => {
  const cutFolder: VaultClipboard = {
    tab: "hosts", mode: "cut", items: [], folderIds: ["f1"], sourceVaultIds: ["team-a"],
  };
  const a = adapter({
    vaultIdOf: () => "team-a",
    targetVaultId: () => "team-b",
    folderContentKinds: () => ["connection"],
    danglingKinds: () => [],
    // Full rights over what actually moves; no EDIT_IDENTITIES anywhere.
    can: (permission, vaultId) =>
      permission !== "EDIT_IDENTITIES" || (vaultId !== "team-a" && vaultId !== "team-b"),
  });

  const r = await pasteFromClipboard(cutFolder, a);

  expect(r).toMatchObject({ moved: 1 });
  expect(a.moveFolder).toHaveBeenCalledWith("f1", "dest", "team-b");
});

test("a dangling reference refuses the paste and is reported apart from permissions", async () => {
  const a = adapter({
    targetVaultId: () => "team-b",
    danglingKinds: () => ["identity"],
  });

  const r = await pasteFromClipboard(cut, a);

  expect(r).toMatchObject({ moved: 0, created: 0, dangling: ["identity"] });
  expect(r.blocked).toBeUndefined();
  expect(a.moveItems).not.toHaveBeenCalled();
});

// At a root every object keeps its own vault, so no reference can be orphaned by
// the paste and the check must not run.
test("a root paste skips the dangling check", async () => {
  const dangling = vi.fn(() => ["identity" as const]);
  const a = adapter({ targetFolderId: () => null, targetVaultId: () => null, danglingKinds: dangling });

  await pasteFromClipboard(cut, a);

  expect(dangling).not.toHaveBeenCalled();
});

/** A paste whose store call takes long enough for a second one to overlap it. */
function slowAdapter() {
  return adapter({ moveItems: vi.fn(() => new Promise<void>((r) => setTimeout(r, 10))) });
}

const otherCut: VaultClipboard = {
  tab: "hosts", mode: "cut",
  items: [{ id: "c2", kind: "connection" }], folderIds: [], sourceVaultIds: ["personal"],
};


test("two overlapping pastes each keep their history entry when serialized", async () => {
  resetHistory();
  await Promise.all([
    runPaste(() => pasteFromClipboard(cut, slowAdapter())),
    runPaste(() => pasteFromClipboard(otherCut, slowAdapter())),
  ]);
  expect(useHistoryStore.getState().past).toHaveLength(2);
});

test("unserialized, one of the two loses its entry to the other's withoutHistory window", async () => {
  // Why runPaste exists: the window is a depth counter, so a paste that starts
  // while another holds it open has its push silently dropped.
  resetHistory();
  await Promise.all([
    pasteFromClipboard(cut, slowAdapter()),
    pasteFromClipboard(otherCut, slowAdapter()),
  ]);
  expect(useHistoryStore.getState().past).toHaveLength(1);
});

test("a rejected paste does not stall the pastes queued behind it", async () => {
  resetHistory();
  await expect(runPaste(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  await expect(runPaste(() => pasteFromClipboard(cut, adapter()))).resolves.toMatchObject({ moved: 1 });
});
