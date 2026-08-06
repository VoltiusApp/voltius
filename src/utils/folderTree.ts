import type { Folder } from "@/types";

/**
 * The folders a form may file its object into. `useFolderStore` holds every
 * type at once — connection, keychain and port_forwarding — so a form handed
 * the raw list offers the other pages' folders, and picking one files the
 * object where its own page will never show it.
 */
export function folderOptionsFor(folders: Folder[], objectType: string): Folder[] {
  return folders.filter((f) => f.object_type === objectType);
}

/** Ids of `rootId` plus every folder nested beneath it. Tolerates parent cycles. */
export function folderSubtreeIds(folders: Folder[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (ids.has(f.id)) continue;
      if (f.parent_folder_id && ids.has(f.parent_folder_id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Items filed anywhere in the subtree rooted at `rootId`. */
export function itemsInFolderSubtree<T extends { folder_id?: string | null }>(
  items: T[],
  folders: Folder[],
  rootId: string,
): T[] {
  const ids = folderSubtreeIds(folders, rootId);
  return items.filter((i) => i.folder_id != null && ids.has(i.folder_id));
}
