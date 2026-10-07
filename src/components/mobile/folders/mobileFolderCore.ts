/** Pure folder-tree helpers — no React/zustand so they're node-strip-types testable. */

export interface FolderLike {
  id: string;
  name: string;
  object_type: string;
  parent_folder_id?: string | null;
  vault_id?: string | null;
}

export interface MoveTarget {
  id: string | null;
  name: string;
  depth: number;
}

export interface ItemLike {
  folder_id?: string | null;
}

// Same as rootedParentId in utils/folderTree: this module stays import-free for strip-types tests.
function rootedParentId(parentId: string | null | undefined, knownIds: ReadonlySet<string>): string | null {
  return parentId && knownIds.has(parentId) ? parentId : null;
}

/** Flattened, depth-first, alpha-within-level folder list for the move picker,
 *  limited to the item's own vault. Leads with a synthetic "No folder" (root) entry,
 *  which the sheet labels. `compare` orders names; callers pass the app-language collator. */
export function buildMoveTargets(
  folders: FolderLike[],
  objectType: string,
  vaultId: string,
  compare: (a: string, b: string) => number = (a, b) => a.localeCompare(b),
): MoveTarget[] {
  const scoped = folders.filter((f) => f.object_type === objectType && (f.vault_id ?? "personal") === vaultId);
  const known = new Set(scoped.map((f) => f.id));
  const out: MoveTarget[] = [{ id: null, name: "No folder", depth: 0 }];
  const walk = (parentId: string | null, depth: number) => {
    const children = scoped
      .filter((f) => rootedParentId(f.parent_folder_id, known) === parentId)
      .sort((a, b) => compare(a.name, b.name));
    for (const c of children) {
      out.push({ id: c.id, name: c.name, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Items whose folder_id matches the active scope (null === root / no folder). */
export function scopeItems<T extends ItemLike>(items: T[], folderId: string | null, knownFolderIds?: ReadonlySet<string>): T[] {
  return items.filter((i) => (knownFolderIds ? rootedParentId(i.folder_id, knownFolderIds) : (i.folder_id ?? null)) === folderId);
}
