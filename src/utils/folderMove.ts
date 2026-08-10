import type { Folder } from "@/types";

interface MoveFolderTreeToVaultInput {
  root: Folder;
  /** `root`'s descendants, breadth-first. */
  subFolders: Folder[];
  /** Where the root ends up; null puts it at the top level. */
  parentFolderId: string | null;
  vaultId: string;
  updateFolder: (
    id: string,
    data: { name: string; object_type: string; parent_folder_id?: string; vault_id: string },
  ) => Promise<unknown>;
}

/**
 * Moves a folder and its subtree into `vaultId`, reparenting the root at the same
 * time. Only the folders — the items under them are the caller's to carry, since
 * each page's objects move by their own store method.
 *
 * Goes through updateFolder rather than a bare write so the stores' team-vault
 * migration applies.
 */
export async function moveFolderTreeToVault({
  root,
  subFolders,
  parentFolderId,
  vaultId,
  updateFolder,
}: MoveFolderTreeToVaultInput): Promise<void> {
  await updateFolder(root.id, {
    name: root.name,
    object_type: root.object_type,
    parent_folder_id: parentFolderId ?? undefined,
    vault_id: vaultId,
  });
  for (const sf of subFolders) {
    await updateFolder(sf.id, {
      name: sf.name,
      object_type: sf.object_type,
      parent_folder_id: sf.parent_folder_id,
      vault_id: vaultId,
    });
  }
}
