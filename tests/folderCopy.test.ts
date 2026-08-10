import { test, expect, vi } from "vitest";
import type { Folder } from "@/types";
import { cloneFolderTree, copyFolderSubtree } from "@/utils/folderCopy";

function folder(id: string, over: Partial<Folder> = {}): Folder {
  return { id, name: id, object_type: "connection", vault_id: "personal", created_at: "", updated_at: "", clocks: {}, ...over } as Folder;
}

function saveFolderSpy() {
  return vi.fn(async (d: { name: string; parent_folder_id?: string; vault_id: string }) => ({ id: `new-${d.name}` }));
}

test("the clone's root is suffixed unless keepName, and its children never are", async () => {
  const saveFolder = saveFolderSpy();
  await cloneFolderTree({
    root: folder("root"),
    subFolders: [folder("child", { parent_folder_id: "root" })],
    parentFolderId: null,
    vaultId: "team-1",
    keepName: false,
    saveFolder,
  });

  expect(saveFolder.mock.calls.map((c) => c[0].name)).toEqual(["root (copy)", "child"]);
});

test("the clone lands under the given parent, and every folder in the destination vault", async () => {
  const saveFolder = saveFolderSpy();
  const { root, folderIdMap } = await cloneFolderTree({
    root: folder("root", { parent_folder_id: "somewhere-else" }),
    subFolders: [folder("child", { parent_folder_id: "root" })],
    parentFolderId: "dest",
    vaultId: "team-1",
    keepName: true,
    saveFolder,
  });

  expect(saveFolder.mock.calls[0][0]).toMatchObject({ parent_folder_id: "dest", vault_id: "team-1" });
  expect(saveFolder.mock.calls[1][0]).toMatchObject({ parent_folder_id: "new-root", vault_id: "team-1" });
  expect(root.id).toBe("new-root");
  expect([...folderIdMap]).toEqual([["root", "new-root"], ["child", "new-child"]]);
});

test("a subfolder whose parent is outside the subtree is reparented onto the new root", async () => {
  const saveFolder = saveFolderSpy();
  const { folderIdMap } = await cloneFolderTree({
    root: folder("root"),
    subFolders: [folder("orphan", { parent_folder_id: "gone" })],
    parentFolderId: null,
    vaultId: "personal",
    keepName: true,
    saveFolder,
  });

  expect(saveFolder.mock.calls[1][0].parent_folder_id).toBe("new-root");
  expect(folderIdMap.get("orphan")).toBe("new-orphan");
});

test("copyFolderSubtree keeps the root's name when the destination vault has no clash", async () => {
  const saveFolder = saveFolderSpy();
  await copyFolderSubtree({
    root: folder("root"),
    subFolders: [],
    vaultId: "team-1",
    existingFolders: [folder("root")],
    saveFolder,
  });

  expect(saveFolder.mock.calls[0][0].name).toBe("root");
});

test("copyFolderSubtree suffixes the root when the destination vault already holds the name", async () => {
  const saveFolder = saveFolderSpy();
  await copyFolderSubtree({
    root: folder("root"),
    subFolders: [],
    vaultId: "team-1",
    existingFolders: [folder("other", { name: "root", vault_id: "team-1" })],
    saveFolder,
  });

  expect(saveFolder.mock.calls[0][0].name).toBe("root (copy)");
});

test("copyFolderSubtree only clashes with a folder of the same object type", async () => {
  const saveFolder = saveFolderSpy();
  await copyFolderSubtree({
    root: folder("root"),
    subFolders: [],
    vaultId: "team-1",
    existingFolders: [folder("other", { name: "root", vault_id: "team-1", object_type: "snippet" })],
    saveFolder,
  });

  expect(saveFolder.mock.calls[0][0].name).toBe("root");
});

test("copyFolderSubtree keeps the root where it was, unlike a paste", async () => {
  const saveFolder = saveFolderSpy();
  await copyFolderSubtree({
    root: folder("root", { parent_folder_id: "parent" }),
    subFolders: [],
    vaultId: "team-1",
    existingFolders: [],
    saveFolder,
  });

  expect(saveFolder.mock.calls[0][0].parent_folder_id).toBe("parent");
});
