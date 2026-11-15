import type { Folder, FolderFormData } from "@/types";
import { copyingRulesOf } from "@/services/ruleSetIntent";

type SaveFolder<T> = (data: Omit<FolderFormData, "pinned"> & { vault_id: string }) => Promise<T>;

interface CloneFolderTreeInput<T extends { id: string }> {
  root: Folder;
  /** `root`'s descendants, breadth-first — a parent must exist before its child. */
  subFolders: Folder[];
  /** Where the clone's root goes; null puts it at the top level. */
  parentFolderId: string | null;
  vaultId: string;
  /** False suffixes the root with "(copy)"; the subfolders always keep theirs. */
  keepName: boolean;
  saveFolder: SaveFolder<T>;
}

interface CopyFolderSubtreeInput<T extends { id: string }> {
  root: Folder;
  /** `root`'s descendants, breadth-first — a parent must exist before its child. */
  subFolders: Folder[];
  vaultId: string;
  /** Every folder already in the app, to spot a name clash in the destination. */
  existingFolders: Folder[];
  saveFolder: SaveFolder<T>;
}

/**
 * Recreates a folder and its subtree under `parentFolderId`, returning the new
 * root and old id → new id for every folder created, so the caller can re-file
 * the items underneath.
 *
 * Only the root is ever renamed: suffixing every descendant would compound to
 * "Prod (copy) (copy)" on a second paste.
 */
export async function cloneFolderTree<T extends { id: string }>({
  root,
  subFolders,
  parentFolderId,
  vaultId,
  keepName,
  saveFolder,
}: CloneFolderTreeInput<T>): Promise<{ root: T; folderIdMap: Map<string, string> }> {
  const copyOf = (f: Folder, name: string, parentId: string | undefined) => saveFolder(copyingRulesOf({
    name,
    object_type: f.object_type,
    parent_folder_id: parentId,
    vault_id: vaultId,
    color: f.color,
    icon: f.icon,
  }, f.id));

  // default name suffix kept in English until all creation sites are localized together (see i18n issue #14)
  const newRoot = await copyOf(root, keepName ? root.name : `${root.name} (copy)`, parentFolderId ?? undefined);
  const folderIdMap = new Map<string, string>([[root.id, newRoot.id]]);

  // BFS order guarantees a parent is created before its children.
  for (const sf of subFolders) {
    const created = await copyOf(sf, sf.name, folderIdMap.get(sf.parent_folder_id ?? "") ?? newRoot.id);
    folderIdMap.set(sf.id, created.id);
  }

  return { root: newRoot, folderIdMap };
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
  const destHasName = existingFolders.some(
    (f) => (f.vault_id ?? "personal") === vaultId && f.object_type === root.object_type && f.name === root.name,
  );
  const { folderIdMap } = await cloneFolderTree({
    root,
    subFolders,
    parentFolderId: root.parent_folder_id ?? null,
    vaultId,
    keepName: !destHasName,
    saveFolder,
  });
  return folderIdMap;
}
