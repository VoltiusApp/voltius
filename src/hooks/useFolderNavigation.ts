import { useMemo, useState } from "react";

export interface FolderNavigable {
  id: string;
  parent_folder_id?: string | null;
}

/**
 * Generic folder navigation hook — tracks breadcrumb path and derives
 * visible folders at the current level.
 */
export function useFolderNavigation<T extends FolderNavigable>(allFolders: T[]) {
  const [folderPath, setFolderPath] = useState<T[]>([]);
  const activeFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null;
  const ejectTargetFolderId = folderPath.length > 1 ? folderPath[folderPath.length - 2].id : null;

  const visibleFolders = useMemo(
    () => allFolders.filter((f) => (f.parent_folder_id ?? null) === activeFolderId),
    [allFolders, activeFolderId],
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
