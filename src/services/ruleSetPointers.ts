import { PERM_BITS } from "@/services/permissions";
import type { TeamObjectType } from "@/services/teamObjects";
import type { TeamAccessEntries } from "@/stores/teamObjectAccessStore";

export type Pointer = string | null | undefined;

export const isFolderType = (type: TeamObjectType): boolean => type === "folder" || type === "snippet_folder";

export function setOfParent(entries: TeamAccessEntries, parentId: string | null): string | null {
  const parent = parentId ? entries[parentId] : undefined;
  return parent && !parent.deleted ? parent.ruleSetId : null;
}

export function isSynced(entries: TeamAccessEntries, objectId: string): boolean {
  const entry = entries[objectId];
  return !!entry && entry.ruleSetId === setOfParent(entries, entry.parentId);
}

const canManage = (mask: number) => (mask & PERM_BITS.MANAGE_ROLES) !== 0;

export function pointerForSave({ entries, objectId, nextParentId, canManageAtRoot }: {
  entries: TeamAccessEntries;
  objectId: string;
  nextParentId: string | null;
  canManageAtRoot: boolean;
}): Pointer {
  const current = entries[objectId];
  const target = setOfParent(entries, nextParentId);
  if (!current) return target;
  if (current.deleted || current.parentId === nextParentId) return undefined;
  const destination = nextParentId ? entries[nextParentId] : undefined;
  if (nextParentId && (!destination || destination.deleted)) return undefined;
  if (!isSynced(entries, objectId) || target === current.ruleSetId) return undefined;
  const mayManageDestination = destination ? canManage(destination.myPermissions) : canManageAtRoot;
  return canManage(current.myPermissions) && mayManageDestination ? target : undefined;
}

export function syncedSubtree(entries: TeamAccessEntries, folderId: string): string[] {
  const root = entries[folderId];
  if (!root) return [];
  const out: string[] = [];
  const seen = new Set([folderId]);
  const queue = [folderId];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const [id, entry] of Object.entries(entries)) {
      if (seen.has(id) || entry.deleted || entry.parentId !== parent || entry.ruleSetId !== root.ruleSetId) continue;
      seen.add(id);
      out.push(id);
      if (isFolderType(entry.type)) queue.push(id);
    }
  }
  return out;
}
