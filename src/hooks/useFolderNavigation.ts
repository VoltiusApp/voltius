import { useEffect, useMemo, useState } from "react";
import { rootedParentId } from "@/utils/folderTree";

export interface FolderNavigable {
  id: string;
  parent_folder_id?: string | null;
}

const rememberedFolders = new Map<string, string | null>();

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
  const activeFolderId = stale ? null : openId;

  const folderPath = useMemo(() => {
    const path: T[] = [];
    for (let id = activeFolderId; id !== null && !path.some((f) => f.id === id);) {
      const folder = byId.get(id)!;
      path.unshift(folder);
      id = rootedParentId(folder.parent_folder_id, byId);
    }
    return path;
  }, [activeFolderId, byId]);
  const ejectTargetFolderId = folderPath.length > 1 ? folderPath[folderPath.length - 2].id : null;

  const visibleFolders = useMemo(
    () => allFolders.filter((f) => rootedParentId(f.parent_folder_id, byId) === activeFolderId),
    [allFolders, byId, activeFolderId],
  );

  const navigateInto = (folder: T) => setOpenId(folder.id);
  const navigateTo = (index: number) => setOpenId(folderPath[index]?.id ?? null);
  const navigateToRoot = () => setOpenId(null);
  const navigateUp = () => setOpenId(ejectTargetFolderId);
  const onFolderDeleted = (id: string) => {
    if (folderPath.some((f) => f.id === id)) setOpenId(null);
  };

  return {
    folderPath,
    activeFolderId,
    ejectTargetFolderId,
    visibleFolders,
    navigateInto,
    navigateTo,
    navigateToRoot,
    navigateUp,
    onFolderDeleted,
  };
}
