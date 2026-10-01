import { useEffect, useMemo, useState } from "react";
import { rootedParentId } from "@/utils/folderTree";

export interface FolderNavigable {
  id: string;
  parent_folder_id?: string | null;
}

/**
 * Generic folder navigation hook — tracks breadcrumb path and derives
 * visible folders at the current level.
 */
export function useFolderNavigation<T extends FolderNavigable>(allFolders: T[]) {
  const [storedPath, setFolderPath] = useState<T[]>([]);
  const known = useMemo(() => new Set(allFolders.map((f) => f.id)), [allFolders]);
  // A path into folders that left the list (vault switched, folder deleted elsewhere) falls back to the root.
  const stale = storedPath.some((f) => !known.has(f.id));
  useEffect(() => {
    if (stale) setFolderPath([]);
  }, [stale]);
  const folderPath = stale ? [] : storedPath;
  const activeFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null;
  const ejectTargetFolderId = folderPath.length > 1 ? folderPath[folderPath.length - 2].id : null;

  const visibleFolders = useMemo(
    () => allFolders.filter((f) => rootedParentId(f.parent_folder_id, known) === activeFolderId),
    [allFolders, known, activeFolderId],
  );

  const navigateInto = (folder: T) => setFolderPath((p) => [...p, folder]);
  const navigateTo = (index: number) => setFolderPath((p) => p.slice(0, index + 1));
  const navigateToRoot = () => setFolderPath([]);
  const onFolderDeleted = (id: string) =>
    setFolderPath((p) => (p.some((f) => f.id === id) ? [] : p));

  return {
    folderPath,
    setFolderPath,
    activeFolderId,
    ejectTargetFolderId,
    visibleFolders,
    navigateInto,
    navigateTo,
    navigateToRoot,
    onFolderDeleted,
  };
}
