import { test, expect, vi } from "vitest";
import type { Folder } from "@/types";
import { vaultClipboardBase } from "@/utils/vaultClipboardBase";

function folder(id: string, over: Partial<Folder> = {}): Folder {
  return { id, name: id, object_type: "connection", vault_id: "personal", created_at: "", updated_at: "", clocks: {}, ...over } as Folder;
}

const folders = [
  folder("root"),
  folder("mid", { parent_folder_id: "root" }),
  folder("team-folder", { vault_id: "team-1" }),
];

function base(over: Partial<Parameters<typeof vaultClipboardBase>[0]> = {}) {
  return vaultClipboardBase({
    navItem: "hosts",
    entities: [
      { kind: "key", items: [{ id: "k1", vault_id: "team-1", folder_id: "mid" }] },
      { kind: "identity", items: [{ id: "i1" }] },
    ],
    folders,
    selectedIdSet: new Set(["k1", "i1"]),
    focusedId: "k1",
    activeFolderId: null,
    scopedVaultId: null,
    accessibleVaultIds: ["personal", "team-1"],
    vaultOptions: [{ id: "personal", name: "Personal" }, { id: "team-1", name: "Team One" }],
    can: () => true,
    confirmCrossVault: undefined,
    setSelection: vi.fn(),
    migrateFolderTreeToVault: vi.fn(async () => {}),
    moveFolder: vi.fn(async () => {}),
    copyFolderInto: vi.fn(async () => ({ id: "clone" })),
    deleteFolder: vi.fn(async () => {}),
    ...over,
  });
}

test("a folder is classified as one even before the entities are searched", () => {
  const { adapter } = base({ entities: [{ kind: "key", items: [{ id: "root" }] }] });
  expect(adapter.classify("root")).toBe("folder");
});

test("classify returns the kind of the first entity list holding the id, and null for a stranger", () => {
  const { adapter } = base();
  expect(adapter.classify("k1")).toBe("key");
  expect(adapter.classify("i1")).toBe("identity");
  expect(adapter.classify("gone")).toBeNull();
});

test("an id is known if any entity or folder holds it", () => {
  const { adapter } = base();
  expect(adapter.exists("k1")).toBe(true);
  expect(adapter.exists("mid")).toBe(true);
  expect(adapter.exists("gone")).toBe(false);
});

test("an object with no vault falls back to personal", () => {
  const { adapter } = base();
  expect(adapter.vaultIdOf("k1")).toBe("team-1");
  expect(adapter.vaultIdOf("i1")).toBe("personal");
  expect(adapter.vaultIdOf("team-folder")).toBe("team-1");
});

test("folderIdOf reads an item's folder and a folder's parent", () => {
  const { adapter } = base();
  expect(adapter.folderIdOf("k1")).toBe("mid");
  expect(adapter.folderIdOf("mid")).toBe("root");
  expect(adapter.folderIdOf("root")).toBeNull();
  expect(adapter.folderIdOf("i1")).toBeNull();
});

test("the root has a destination vault only when one vault is on screen", () => {
  expect(base().vaultForFolder(null)).toBeNull();
  expect(base({ scopedVaultId: "team-1" }).vaultForFolder(null)).toBe("team-1");
  expect(base().vaultForFolder("team-folder")).toBe("team-1");
});

test("the destination is named from the active folder's vault", () => {
  const { adapter } = base({ activeFolderId: "team-folder" });
  expect(adapter.targetVaultId()).toBe("team-1");
  expect(adapter.targetVaultName()).toBe("Team One");
  expect(base().adapter.targetVaultName()).toBe("");
});

test("a folder cannot be moved into itself or into its own descendant", () => {
  const { adapter } = base();
  expect(adapter.canMoveFolder("root", "root")).toBe(false);
  expect(adapter.canMoveFolder("root", "mid")).toBe(false);
  expect(adapter.canMoveFolder("mid", "root")).toBe(true);
  expect(adapter.canMoveFolder("root", null)).toBe(true);
});

test("a same-vault folder move only reparents", async () => {
  const moveFolder = vi.fn(async () => {});
  const migrateFolderTreeToVault = vi.fn(async () => {});
  const { adapter } = base({ moveFolder, migrateFolderTreeToVault });

  await adapter.moveFolder("mid", "root", "personal");
  expect(moveFolder).toHaveBeenCalledWith("mid", "root");
  expect(migrateFolderTreeToVault).not.toHaveBeenCalled();
});

test("a cross-vault folder move carries the subtree instead", async () => {
  const moveFolder = vi.fn(async () => {});
  const migrateFolderTreeToVault = vi.fn(async () => {});
  const { adapter } = base({ moveFolder, migrateFolderTreeToVault });

  await adapter.moveFolder("mid", null, "team-1");
  expect(migrateFolderTreeToVault).toHaveBeenCalledWith(folders[1], null, "team-1");
  expect(moveFolder).not.toHaveBeenCalled();
});

test("a folder move at the root reparents rather than migrating", async () => {
  const moveFolder = vi.fn(async () => {});
  const migrateFolderTreeToVault = vi.fn(async () => {});
  const { adapter } = base({ moveFolder, migrateFolderTreeToVault });

  await adapter.moveFolder("mid", null, null);
  expect(moveFolder).toHaveBeenCalledWith("mid", null);
  expect(migrateFolderTreeToVault).not.toHaveBeenCalled();
});

test("a vanished folder is not moved at all", async () => {
  const moveFolder = vi.fn(async () => {});
  const { adapter } = base({ moveFolder });

  await adapter.moveFolder("gone", null, null);
  expect(moveFolder).not.toHaveBeenCalled();
});

test("a folder clone keeps its name where the destination has no clash", async () => {
  const copyFolderInto = vi.fn(async () => ({ id: "clone" }));
  const { adapter } = base({ copyFolderInto });

  expect(await adapter.duplicateFolder("mid", "team-folder")).toBe("clone");
  expect(copyFolderInto).toHaveBeenCalledWith("mid", "team-folder", "team-1", { keepName: true });
});

test("a folder clone alongside a folder of the same name is suffixed", async () => {
  const copyFolderInto = vi.fn(async () => ({ id: "clone" }));
  const { adapter } = base({
    copyFolderInto,
    folders: [...folders, folder("twin", { name: "mid" })],
  });

  await adapter.duplicateFolder("mid", null);
  expect(copyFolderInto).toHaveBeenCalledWith("mid", null, undefined, { keepName: false });
});
