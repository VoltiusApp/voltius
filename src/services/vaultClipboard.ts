import type { NavItem } from "@/stores/uiStore";
import type { VaultClipboard } from "@/stores/vaultClipboardStore";

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
    if (itemIds.length > 0) await adapter.moveItems(itemIds, target);
    for (const id of folderIds) await adapter.moveFolder(id, target);
    const moved = itemIds.length + folderIds.length;
    if (moved > 0) adapter.setSelection([...itemIds, ...folderIds]);
    return { moved, created: 0, skipped };
  }

  const createdItemIds =
    liveItems.length > 0 ? await adapter.duplicateItems(liveItems.map((i) => i.id), target) : [];
  const createdFolderIds: string[] = [];
  for (const id of liveFolders) createdFolderIds.push(await adapter.duplicateFolder(id, target));

  const created = createdItemIds.length + createdFolderIds.length;
  if (created > 0) adapter.setSelection([...createdItemIds, ...createdFolderIds]);
  return { moved: 0, created, skipped };
}
