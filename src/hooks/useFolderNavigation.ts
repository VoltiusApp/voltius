import { useEffect, useMemo, useState } from "react";
import { rootedParentId } from "@/utils/folderTree";

export interface FolderNavigable {
  id: string;
  parent_folder_id?: string | null;
}

const rememberedFolders = new Map<string, string | null>();

/** Path, subfolders and parent of folder `id`; a folder no longer in the list reads as the root. */
export function folderLevel<T extends FolderNavigable>(allFolders: T[], byId: Map<string, T>, id: string | null) {
  const activeFolderId = id !== null && byId.has(id) ? id : null;
  const folderPath: T[] = [];
  for (let at = activeFolderId; at !== null && !folderPath.some((f) => f.id === at);) {
    const folder = byId.get(at)!;
    folderPath.unshift(folder);
    at = rootedParentId(folder.parent_folder_id, byId);
  }
  return {
    activeFolderId,
    folderPath,
    ejectTargetFolderId: folderPath.length > 1 ? folderPath[folderPath.length - 2].id : null,
    visibleFolders: allFolders.filter((f) => rootedParentId(f.parent_folder_id, byId) === activeFolderId),
  };
}

/**
 * Generic folder navigation hook — tracks breadcrumb path and derives
 * visible folders at the current level. With `rememberAs`, the open folder survives the page unmounting.
 */
export function useFolderNavigation<T extends FolderNavigable>(allFolders: T[], rememberAs?: string) {
  const [openId, setOpenId] = useState<string | null>(() => (rememberAs && rememberedFolders.get(rememberAs)) || null);
  const byId = useMemo(() => new Map(allFolders.map((f) => [f.id, f])), [allFolders]);
  // A folder that left the list (vault switched, folder deleted elsewhere) falls back to the root.
  const stale = openId !== null && !byId.has(openId);
  useEffect(() => {
    if (stale) setOpenId(null);
  }, [stale]);
  useEffect(() => {
    if (rememberAs) rememberedFolders.set(rememberAs, openId);
  }, [rememberAs, openId]);
  const level = useMemo(() => folderLevel(allFolders, byId, openId), [allFolders, byId, openId]);
  const { folderPath, ejectTargetFolderId } = level;

  const navigateInto = (folder: T) => setOpenId(folder.id);
  const navigateTo = (index: number) => setOpenId(folderPath[index]?.id ?? null);
  const navigateToRoot = () => setOpenId(null);
  const navigateUp = () => setOpenId(ejectTargetFolderId);
  const onFolderDeleted = (id: string) => {
    if (folderPath.some((f) => f.id === id)) setOpenId(null);
  };

  return {
    ...level,
    levelOf: (id: string | null) => folderLevel(allFolders, byId, id),
    navigateInto,
    navigateTo,
    navigateToRoot,
    navigateUp,
    onFolderDeleted,
  };
}
