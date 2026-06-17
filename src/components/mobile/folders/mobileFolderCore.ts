/** Pure folder-tree helpers — no React/zustand so they're node-strip-types testable. */

export interface FolderLike {
  id: string;
  name: string;
  object_type: string;
  parent_folder_id?: string | null;
}

export interface MoveTarget {
  id: string | null;
  name: string;
  depth: number;
}

export interface ItemLike {
  folder_id?: string | null;
}

/** Flattened, depth-first, alpha-within-level folder list for the move picker.
 *  Leads with a synthetic "No folder" (root) entry. */
export function buildMoveTargets(folders: FolderLike[], objectType: string): MoveTarget[] {
  const scoped = folders.filter((f) => f.object_type === objectType);
  const out: MoveTarget[] = [{ id: null, name: "No folder", depth: 0 }];
  const walk = (parentId: string | null, depth: number) => {
    const children = scoped
      .filter((f) => (f.parent_folder_id ?? null) === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const c of children) {
      out.push({ id: c.id, name: c.name, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Items whose folder_id matches the active scope (null === root / no folder). */
export function scopeItems<T extends ItemLike>(items: T[], folderId: string | null): T[] {
  return items.filter((i) => (i.folder_id ?? null) === folderId);
}

export function folderItemCount(items: ItemLike[], folderId: string): number {
  return items.reduce((n, i) => ((i.folder_id ?? null) === folderId ? n + 1 : n), 0);
}
