import { test, expect, vi } from "vitest";
import type { Folder } from "@/types";
import { moveFolderTreeToVault } from "@/utils/folderMove";

function folder(id: string, over: Partial<Folder> = {}): Folder {
  return { id, name: id, object_type: "connection", vault_id: "personal", created_at: "", updated_at: "", clocks: {}, ...over } as Folder;
}

test("the root and every descendant land in the destination vault, parents first", async () => {
  const updateFolder = vi.fn(async () => {});
  await moveFolderTreeToVault({
    root: folder("root"),
    subFolders: [folder("mid", { parent_folder_id: "root" }), folder("leaf", { parent_folder_id: "mid" })],
    parentFolderId: null,
    vaultId: "team-1",
    updateFolder,
  });

  expect(updateFolder.mock.calls.map((c) => c[0])).toEqual(["root", "mid", "leaf"]);
  expect(updateFolder.mock.calls.every((c) => (c[1] as { vault_id: string }).vault_id === "team-1")).toBe(true);
});

test("only the root is reparented; the subtree keeps its shape", async () => {
  const updateFolder = vi.fn(async () => {});
  await moveFolderTreeToVault({
    root: folder("root", { parent_folder_id: "old-parent" }),
    subFolders: [folder("mid", { parent_folder_id: "root" })],
    parentFolderId: "dest",
    vaultId: "team-1",
    updateFolder,
  });

  expect(updateFolder.mock.calls[0][1]).toMatchObject({ parent_folder_id: "dest" });
  expect(updateFolder.mock.calls[1][1]).toMatchObject({ parent_folder_id: "root" });
});

test("a null parent moves the root to the top level rather than leaving it where it was", async () => {
  const updateFolder = vi.fn(async () => {});
  await moveFolderTreeToVault({
    root: folder("root", { parent_folder_id: "old-parent" }),
    subFolders: [],
    parentFolderId: null,
    vaultId: "personal",
    updateFolder,
  });

  expect(updateFolder.mock.calls[0][1]).toMatchObject({ parent_folder_id: undefined });
});
