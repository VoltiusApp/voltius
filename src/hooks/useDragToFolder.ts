import { useRef, useState } from "react";

/**
 * Creates a drag ghost outside the transformed #root so the browser renders it
 * at full visual size without clipping, and positions the hotspot correctly.
 */
function setDragImageOutsideTransform(e: React.DragEvent) {
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;margin:0;`;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, e.clientX - rect.left, e.clientY - rect.top);
  requestAnimationFrame(() => ghost.remove());
}

interface UseDragToFolderOptions {
  /** Currently selected item IDs — used to expand single-item drag to multi-select. */
  selectedIdSet: Set<string>;
  /** Folder IDs visible in the current view — excluded from item drag payload. */
  folderIds: Set<string>;
  /** Called when items are dropped onto a folder. */
  onDropToFolder: (ids: string[], folderId: string) => Promise<void>;
  /** Called when items are dropped onto the eject zone. `targetFolderId` is null when ejecting to root. */
  onEject: (ids: string[], targetFolderId: string | null) => Promise<void>;
  /** Called when folders are dropped onto another folder. Optional — enables folder-as-drag-source. */
  onMoveFolders?: (folderIds: string[], targetParentId: string) => Promise<void>;
  /** Called when folders are dropped onto the eject zone. Optional — pairs with onMoveFolders. */
  onEjectFolders?: (folderIds: string[], targetParentId: string | null) => Promise<void>;
}

interface UseDragToFolderResult {
  isDragging: boolean;
  dragOverFolderId: string | null;
  dragOverEject: boolean;
  /** Start dragging one or more items (snippets, connections, etc.) */
  handleDragStart: (e: React.DragEvent, itemId: string) => void;
  /** Start dragging a folder card itself */
  handleFolderDragStart: (e: React.DragEvent, folderId: string) => void;
  handleDragEnd: () => void;
  folderDropProps: (folderId: string) => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
  };
  ejectDropProps: (targetFolderId: string | null) => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

export function useDragToFolder({
  selectedIdSet,
  folderIds,
  onDropToFolder,
  onEject,
  onMoveFolders,
  onEjectFolders,
}: UseDragToFolderOptions): UseDragToFolderResult {
  const draggingItemIdsRef = useRef<string[]>([]);
  const draggingFolderIdsRef = useRef<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverEject, setDragOverEject] = useState(false);

  // Keep callbacks in refs so folderDropProps/ejectDropProps are stable references.
  const onDropToFolderRef = useRef(onDropToFolder);
  onDropToFolderRef.current = onDropToFolder;
  const onEjectRef = useRef(onEject);
  onEjectRef.current = onEject;
  const onMoveFoldersRef = useRef(onMoveFolders);
  onMoveFoldersRef.current = onMoveFolders;
  const onEjectFoldersRef = useRef(onEjectFolders);
  onEjectFoldersRef.current = onEjectFolders;

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    const ids = (selectedIdSet.has(itemId) ? [...selectedIdSet] : [itemId])
      .filter((id) => !folderIds.has(id));
    draggingItemIdsRef.current = ids;
    setIsDragging(true);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ids.join(","));
    setDragImageOutsideTransform(e);
  };

  const handleFolderDragStart = (e: React.DragEvent, folderId: string) => {
    draggingFolderIdsRef.current = [folderId];
    setIsDragging(true);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", folderId);
    setDragImageOutsideTransform(e);
    e.stopPropagation();
  };

  const handleDragEnd = () => {
    draggingItemIdsRef.current = [];
    draggingFolderIdsRef.current = [];
    setIsDragging(false);
    setDragOverFolderId(null);
    setDragOverEject(false);
  };

  const folderDropProps = (folderId: string) => ({
    onDragOver: (e: React.DragEvent) => {
      const hasItems = draggingItemIdsRef.current.length > 0;
      const hasFolders = draggingFolderIdsRef.current.length > 0
        && !draggingFolderIdsRef.current.includes(folderId); // can't drop onto self
      if (!hasItems && !hasFolders) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverFolderId(folderId);
    },
    onDragLeave: () => setDragOverFolderId(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverFolderId(null);

      const folderDragIds = draggingFolderIdsRef.current;
      if (folderDragIds.length > 0 && !folderDragIds.includes(folderId)) {
        draggingFolderIdsRef.current = [];
        void onMoveFoldersRef.current?.(folderDragIds, folderId);
        return;
      }

      const itemIds = draggingItemIdsRef.current;
      if (itemIds.length === 0) return;
      draggingItemIdsRef.current = [];
      void onDropToFolderRef.current(itemIds, folderId);
    },
  });

  const ejectDropProps = (targetFolderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverEject(true);
    },
    onDragLeave: () => setDragOverEject(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverEject(false);

      const folderDragIds = draggingFolderIdsRef.current;
      if (folderDragIds.length > 0) {
        draggingFolderIdsRef.current = [];
        void onEjectFoldersRef.current?.(folderDragIds, targetFolderId);
        return;
      }

      const itemIds = draggingItemIdsRef.current;
      if (itemIds.length === 0) return;
      draggingItemIdsRef.current = [];
      void onEjectRef.current(itemIds, targetFolderId);
    },
  });

  return {
    isDragging,
    dragOverFolderId,
    dragOverEject,
    handleDragStart,
    handleFolderDragStart,
    handleDragEnd,
    folderDropProps,
    ejectDropProps,
  };
}
