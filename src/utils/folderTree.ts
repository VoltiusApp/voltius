import type { Folder, FolderFormData } from "@/types";

export function folderToFormData(f: Folder): FolderFormData {
  return {
    name: f.name, object_type: f.object_type,
    parent_folder_id: f.parent_folder_id, vault_id: f.vault_id,
    color: f.color, icon: f.icon,
  };
}

/** `folder_update` replaces rather than merges, so fields the caller omits keep their stored value. */
export function newFolderData(object_type: string, parentId: string | null | undefined, vault_id: string | undefined): FolderFormData {
  return { name: "New Folder" /* persisted English default; menu label is localized */, object_type, parent_folder_id: parentId ?? undefined, vault_id };
}

export function overStoredFolder(stored: Folder | undefined, input: FolderFormData): FolderFormData {
  return stored ? { ...folderToFormData(stored), ...input } : input;
}

/**
 * The folders a form may file its object into. `useFolderStore` holds every
 * type at once — connection, keychain and port_forwarding — so a form handed
 * the raw list offers the other pages' folders, and picking one files the
 * object where its own page will never show it.
 */
export function folderOptionsFor(folders: Folder[], objectType: string): Folder[] {
  return folders.filter((f) => f.object_type === objectType);
}

/**
 * Every folder nested beneath `rootId`, breadth-first so a parent always precedes
 * its children — vault moves and copies rely on that order. Tolerates parent cycles,
 * which would otherwise spin forever and lock the renderer.
 */
export function descendantFolders(folders: Folder[], rootId: string): Folder[] {
  const queue = [rootId];
  const result: Folder[] = [];
  const seen = new Set<string>([rootId]);
  while (queue.length) {
    const cur = queue.shift()!;
    const children = folders.filter((f) => f.parent_folder_id === cur && !seen.has(f.id));
    for (const child of children) seen.add(child.id);
    result.push(...children);
    queue.push(...children.map((f) => f.id));
  }
  return result;
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

/** Counts items filed anywhere beneath each folder, so a folder holding only populated subfolders is not empty. */
export function folderItemCounter(
  items: readonly { folder_id?: string | null }[],
  folders: readonly Pick<Folder, "id" | "parent_folder_id">[],
): (folderId: string) => number {
  const parentOf = new Map(folders.map((f) => [f.id, f.parent_folder_id ?? null]));
  const counts = new Map<string, number>();
  for (const item of items) {
    const seen = new Set<string>();
    for (let id = item.folder_id ?? null; id && !seen.has(id); id = parentOf.get(id) ?? null) {
      seen.add(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return (folderId) => counts.get(folderId) ?? 0;
}

export function foldersOutsideSubtree(folders: Folder[], rootId: string): Folder[] {
  const ids = folderSubtreeIds(folders, rootId);
  return folders.filter((f) => !ids.has(f.id));
}

export function rootedParentId(parentId: string | null | undefined, knownIds: ReadonlySet<string>): string | null {
  return parentId && knownIds.has(parentId) ? parentId : null;
}
