interface FolderDragHandlersInput {
  /** Refiles items under `folderId`; null is the root. */
  moveItems: (ids: string[], folderId: string | null) => Promise<void>;
  /** Reparents folders under `parentFolderId`; null is the root. */
  moveFolders: (folderIds: string[], parentFolderId: string | null) => Promise<void>;
  /** Given a message when a drop fails; without it the rejection escapes to the pointer handler. */
  onError?: (message: string) => void;
}

interface FolderDragHandlers {
  onDropToFolder: (ids: string[], folderId: string) => Promise<void>;
  onEject: (ids: string[], targetFolderId: string | null) => Promise<void>;
  onMoveFolders: (folderIds: string[], targetParentId: string) => Promise<void>;
  onEjectFolders: (folderIds: string[], targetParentId: string | null) => Promise<void>;
}

/**
 * The four drop callbacks `useDragToFolder` wants, from the two operations that
 * actually differ. Dropping onto a folder and dropping onto the eject zone are
 * the same move — the eject zone just names the parent, or the root — so a page
 * that treated them differently would be a bug, not a variant.
 */
export function folderDragHandlers({
  moveItems,
  moveFolders,
  onError,
}: FolderDragHandlersInput): FolderDragHandlers {
  const guard = async (run: () => Promise<void>) => {
    if (!onError) return run();
    try {
      await run();
    } catch (err) {
      onError(String(err));
    }
  };
  return {
    onDropToFolder: (ids, folderId) => guard(() => moveItems(ids, folderId)),
    onEject: (ids, targetFolderId) => guard(() => moveItems(ids, targetFolderId)),
    onMoveFolders: (folderIds, targetParentId) => guard(() => moveFolders(folderIds, targetParentId)),
    onEjectFolders: (folderIds, targetParentId) => guard(() => moveFolders(folderIds, targetParentId)),
  };
}
