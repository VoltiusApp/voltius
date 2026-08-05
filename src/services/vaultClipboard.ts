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
  can: (permission: string, vaultId: string) => boolean;
}

export interface PasteResult {
  moved: number;
  created: number;
  skipped: number;
  blocked?: string[];
}

const EMPTY: PasteResult = { moved: 0, created: 0, skipped: 0 };

const EDIT_PERMISSION: Record<string, string> = {
  connection: "EDIT_CONNECTIONS",
  port_forward: "EDIT_CONNECTIONS",
  identity: "EDIT_IDENTITIES",
  key: "EDIT_KEYS",
  snippet: "EDIT_SNIPPETS",
};

/**
 * A cross-vault move is two authorizations — a write on the destination and a
 * delete on the source — issued as separate calls. Both are checked here so a
 * permitted write cannot be followed by a refused delete, which would leave a
 * duplicate where the user asked for a move. The server remains the boundary;
 * this only stops a paste that is already known to fail.
 */
function blockedPermissions(
  clipboard: NonNullable<VaultClipboard>,
  adapter: ClipboardAdapter,
  liveItems: { id: string; kind: string }[],
  liveFolders: string[],
): string[] {
  const target = adapter.targetVaultId();
  const blocked = new Set<string>();

  const require = (permission: string, vaultId: string) => {
    if (!adapter.can(permission, vaultId)) blocked.add(permission);
  };

  for (const item of liveItems) {
    const source = adapter.vaultIdOf(item.id);
    const permission = EDIT_PERMISSION[item.kind] ?? "EDIT_CONNECTIONS";
    if (source === target) continue;
    require(permission, target);
    if (clipboard.mode === "cut") require(permission, source);
  }
  for (const id of liveFolders) {
    const source = adapter.vaultIdOf(id);
    if (source === target) continue;
    require("EDIT_FOLDERS", target);
    if (clipboard.mode === "cut") require("EDIT_FOLDERS", source);
  }
  return [...blocked];
}

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

  const blocked = blockedPermissions(clipboard, adapter, liveItems, liveFolders);
  if (blocked.length > 0) return { ...EMPTY, skipped, blocked };

  if (clipboard.mode === "cut") {
    const itemIds = liveItems.map((i) => i.id).filter((id) => adapter.folderIdOf(id) !== target);
    const folderIds = liveFolders.filter((id) => adapter.folderIdOf(id) !== target);
    const origins = new Map<string, string | null>();
    for (const id of [...itemIds, ...folderIds]) origins.set(id, adapter.folderIdOf(id));

    // Suppressed: each store method records its own entry, and undoing those
    // stale entries after the composite undo has already run throws on team
    // vaults, which wedges the history stack.
    await useHistoryStore.getState().withoutHistory(async () => {
      if (itemIds.length > 0) await adapter.moveItems(itemIds, target);
      for (const id of folderIds) await adapter.moveFolder(id, target);
    });
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

  const duplicateAll = async () => {
    const items =
      liveItems.length > 0 ? await adapter.duplicateItems(liveItems.map((i) => i.id), target) : [];
    const folders: string[] = [];
    for (const id of liveFolders) folders.push(await adapter.duplicateFolder(id, target));
    return { items, folders };
  };

  // See the cut branch: the per-object entries the stores push are suppressed so
  // this paste owns exactly one history entry.
  let { items: createdItemIds, folders: createdFolderIds } =
    await useHistoryStore.getState().withoutHistory(duplicateAll);

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
      const again = await duplicateAll();
      createdItemIds = again.items;
      createdFolderIds = again.folders;
    },
  });
  return { moved: 0, created, skipped };
}
