import type { NavItem } from "@/stores/uiStore";
import type { VaultClipboard } from "@/stores/vaultClipboardStore";
import { useHistoryStore } from "@/stores/historyStore";

export interface ClipboardAdapter {
  navItem: NavItem;
  /** False once an id has been deleted by a sync, another device, or the user. */
  exists: (id: string) => boolean;
  vaultIdOf: (id: string) => string;
  /** Destination folder, null at the vault root. */
  targetFolderId: () => string | null;
  targetVaultId: () => string;
  /** Current folder of an id, null when it sits at the root. */
  folderIdOf: (id: string) => string | null;
  moveItems: (ids: string[], folderId: string | null) => Promise<void>;
  moveFolder: (id: string, parentFolderId: string | null) => Promise<void>;
  /** Returns the ids of the created duplicates, in the same order. */
  duplicateItems: (ids: string[], folderId: string | null) => Promise<string[]>;
  duplicateFolder: (id: string, parentFolderId: string | null) => Promise<string>;
  deleteItems: (ids: string[]) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  setSelection: (ids: string[]) => void;
}

export interface PasteResult {
  moved: number;
  created: number;
  skipped: number;
  blocked?: string[];
}

const EMPTY: PasteResult = { moved: 0, created: 0, skipped: 0 };

export async function pasteFromClipboard(
  clipboard: VaultClipboard,
  adapter: ClipboardAdapter,
): Promise<PasteResult> {
  if (!clipboard || clipboard.tab !== adapter.navItem) return EMPTY;

  const target = adapter.targetFolderId();
  const liveItems = clipboard.items.filter((i) => adapter.exists(i.id));
  const liveFolders = clipboard.folderIds.filter((id) => adapter.exists(id));
  const skipped =
    clipboard.items.length - liveItems.length + (clipboard.folderIds.length - liveFolders.length);

  if (liveItems.length === 0 && liveFolders.length === 0) {
    return { ...EMPTY, skipped };
  }

  if (clipboard.mode === "cut") {
    const itemIds = liveItems.map((i) => i.id).filter((id) => adapter.folderIdOf(id) !== target);
    const folderIds = liveFolders.filter((id) => adapter.folderIdOf(id) !== target);
    const origins = new Map<string, string | null>();
    for (const id of [...itemIds, ...folderIds]) origins.set(id, adapter.folderIdOf(id));

    if (itemIds.length > 0) await adapter.moveItems(itemIds, target);
    for (const id of folderIds) await adapter.moveFolder(id, target);
    const moved = itemIds.length + folderIds.length;
    if (moved === 0) return { moved: 0, created: 0, skipped };
    adapter.setSelection([...itemIds, ...folderIds]);

    useHistoryStore.getState().push({
      label: `Moved ${moved} item${moved === 1 ? "" : "s"}`,
      undo: async () => {
        // One call per origin folder: moveItems takes a single destination.
        for (const id of itemIds) await adapter.moveItems([id], origins.get(id) ?? null);
        for (const id of folderIds) await adapter.moveFolder(id, origins.get(id) ?? null);
      },
      redo: async () => {
        if (itemIds.length > 0) await adapter.moveItems(itemIds, target);
        for (const id of folderIds) await adapter.moveFolder(id, target);
      },
    });
    return { moved, created: 0, skipped };
  }

  let createdItemIds =
    liveItems.length > 0 ? await adapter.duplicateItems(liveItems.map((i) => i.id), target) : [];
  let createdFolderIds: string[] = [];
  for (const id of liveFolders) createdFolderIds.push(await adapter.duplicateFolder(id, target));

  const created = createdItemIds.length + createdFolderIds.length;
  if (created === 0) return { moved: 0, created: 0, skipped };
  adapter.setSelection([...createdItemIds, ...createdFolderIds]);

  useHistoryStore.getState().push({
    label: `Pasted ${created} item${created === 1 ? "" : "s"}`,
    undo: async () => {
      if (createdItemIds.length > 0) await adapter.deleteItems(createdItemIds);
      for (const id of createdFolderIds) await adapter.deleteFolder(id);
    },
    // Redo re-creates under fresh ids, so the holders must be refreshed for the
    // next undo to delete the right objects.
    redo: async () => {
      createdItemIds =
        liveItems.length > 0 ? await adapter.duplicateItems(liveItems.map((i) => i.id), target) : [];
      createdFolderIds = [];
      for (const id of liveFolders) createdFolderIds.push(await adapter.duplicateFolder(id, target));
    },
  });
  return { moved: 0, created, skipped };
}
