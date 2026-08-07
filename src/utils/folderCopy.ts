import type { Folder } from "@/types";

interface CopyFolderSubtreeInput<T extends { id: string }> {
  root: Folder;
  /** `root`'s descendants, breadth-first — a parent must exist before its child. */
  subFolders: Folder[];
  vaultId: string;
  /** Every folder already in the app, to spot a name clash in the destination. */
  existingFolders: Folder[];
  saveFolder: (data: {
    name: string;
    object_type: string;
    parent_folder_id?: string;
    vault_id: string;
  }) => Promise<T>;
}

/**
 * Recreates a folder and its subtree in another vault, returning old id → new id
 * for every folder created, so the caller can re-file the items underneath.
 *
 * Only the root takes a "(copy)" suffix, and only when the destination already
 * holds a folder of that name — the subfolders keep theirs.
 */
export async function copyFolderSubtree<T extends { id: string }>({
  root,
  subFolders,
  vaultId,
  existingFolders,
  saveFolder,
}: CopyFolderSubtreeInput<T>): Promise<Map<string, string>> {
  const folderIdMap = new Map<string, string>();
  const destHasName = existingFolders.some(
    (f) => (f.vault_id ?? "personal") === vaultId && f.object_type === root.object_type && f.name === root.name,
  );
  // default name suffix kept in English until all creation sites are localized together (see i18n issue #14)
  const newRoot = await saveFolder({
    name: destHasName ? `${root.name} (copy)` : root.name,
    object_type: root.object_type,
    parent_folder_id: root.parent_folder_id,
    vault_id: vaultId,
  });
  folderIdMap.set(root.id, newRoot.id);

  for (const sf of subFolders) {
    const newParentId = sf.parent_folder_id ? (folderIdMap.get(sf.parent_folder_id) ?? newRoot.id) : newRoot.id;
    const newSf = await saveFolder({
      name: sf.name,
      object_type: sf.object_type,
      parent_folder_id: newParentId,
      vault_id: vaultId,
    });
    folderIdMap.set(sf.id, newSf.id);
  }

  return folderIdMap;
}
