import type { TFunction } from "i18next";
import type { Folder } from "@/types";

interface FolderDeleteMessagesInput {
  t: TFunction;
  /** i18n namespace of the page, e.g. `hosts.page`. */
  prefix: string;
  /** The folders the page can see, to tell a folder id from an item id. */
  folders: Folder[];
  /** Ids of every item nested anywhere under `folderId`. */
  itemIdsInFolderTree: (folderId: string) => string[];
}

/**
 * The two delete confirmations every vault-object page shows: one for a folder,
 * one for a selection. Both warn that a delete reaches into the subtree, since
 * nothing on screen says the folder holds anything.
 */
export function folderDeleteMessages({
  t,
  prefix,
  folders,
  itemIdsInFolderTree,
}: FolderDeleteMessagesInput): {
  folderDeleteMessage: (folderId: string) => string;
  bulkDeleteMessage: (ids: string[]) => string;
} {
  return {
    folderDeleteMessage: (folderId) => {
      const count = itemIdsInFolderTree(folderId).length;
      return count === 0
        ? t(`${prefix}.confirmDeleteFolder.messageEmpty`)
        : t(`${prefix}.confirmDeleteFolder.message`, { count });
    },
    bulkDeleteMessage: (ids) => {
      const base = t(`${prefix}.confirmDelete.message`, { count: ids.length });
      const nested = new Set(
        ids.filter((id) => folders.some((f) => f.id === id)).flatMap(itemIdsInFolderTree),
      );
      // An item selected in its own right is already counted by `base`.
      for (const id of ids) nested.delete(id);
      return nested.size === 0
        ? base
        : `${base} ${t(`${prefix}.confirmDelete.folderCascade`, { count: nested.size })}`;
    },
  };
}
