import type { NavItem } from "@/stores/uiStore";
import type { VaultClipboard, VaultClipboardKind } from "@/stores/vaultClipboardStore";
import { useHistoryStore } from "@/stores/historyStore";

export interface ClipboardAdapter {
  navItem: NavItem;
  /** False once an id has been deleted by a sync, another device, or the user. */
  exists: (id: string) => boolean;
  vaultIdOf: (id: string) => string;
  /** Destination folder, null at the vault root. */
  targetFolderId: () => string | null;
  /**
   * Destination vault, or null when the destination is the root — there is no
   * folder there to read a vault from, so every object keeps the vault it has and
   * no cross-vault authorization is needed.
   */
  targetVaultId: () => string | null;
  /** Current folder of an id, null when it sits at the root. */
  folderIdOf: (id: string) => string | null;
  /**
   * Distinct kinds of object nested anywhere under a folder. A folder paste writes
   * its contents too, so those kinds need authorizing alongside EDIT_FOLDERS.
   */
  folderContentKinds: (folderId: string) => VaultClipboardKind[];
  /**
   * False when the move is structurally impossible — reparenting a folder under
   * itself or under one of its own descendants. Consulted before moving so a
   * refused folder is not counted as moved.
   */
  canMoveFolder: (id: string, parentFolderId: string | null) => boolean;
  /**
   * `vaultId` is the vault the objects must end up in, or null to leave each one in
   * the vault it already has. It is passed explicitly rather than derived from
   * `folderId` so an undo can restore an object that came from a vault root, where
   * there is no folder to read the original vault back from.
   */
  moveItems: (ids: string[], folderId: string | null, vaultId: string | null) => Promise<void>;
  moveFolder: (id: string, parentFolderId: string | null, vaultId: string | null) => Promise<void>;
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
  // No destination folder means no vault change, so nothing new to authorize.
  if (target === null) return [];
  const blocked = new Set<string>();

  const require = (permission: string, vaultId: string) => {
    if (!adapter.can(permission, vaultId)) blocked.add(permission);
  };
  const requireBoth = (permission: string, source: string) => {
    require(permission, target);
    if (clipboard.mode === "cut") require(permission, source);
  };

  for (const item of liveItems) {
    const source = adapter.vaultIdOf(item.id);
    if (source === target) continue;
    requireBoth(EDIT_PERMISSION[item.kind] ?? "EDIT_CONNECTIONS", source);
  }
  for (const id of liveFolders) {
    const source = adapter.vaultIdOf(id);
    if (source === target) continue;
    requireBoth("EDIT_FOLDERS", source);
    // The folder's contents cross the vault boundary with it.
    for (const kind of adapter.folderContentKinds(id)) {
      requireBoth(EDIT_PERMISSION[kind] ?? "EDIT_CONNECTIONS", source);
    }
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
    const folderIds = liveFolders.filter(
      (id) => adapter.folderIdOf(id) !== target && adapter.canMoveFolder(id, target),
    );
    const targetVault = adapter.targetVaultId();
    // The origin vault is recorded alongside the origin folder: an object cut from
    // a vault root has no origin folder to read its vault back from at undo time.
    const origins = new Map<string, { folderId: string | null; vaultId: string }>();
    for (const id of [...itemIds, ...folderIds]) {
      origins.set(id, { folderId: adapter.folderIdOf(id), vaultId: adapter.vaultIdOf(id) });
    }
    const originOf = (id: string) => origins.get(id) ?? { folderId: null, vaultId: null };

    // Suppressed: each store method records its own entry, and undoing those
    // stale entries after the composite undo has already run throws on team
    // vaults, which wedges the history stack.
    await useHistoryStore.getState().withoutHistory(async () => {
      if (itemIds.length > 0) await adapter.moveItems(itemIds, target, targetVault);
      for (const id of folderIds) await adapter.moveFolder(id, target, targetVault);
    });
    const moved = itemIds.length + folderIds.length;
    if (moved === 0) return { moved: 0, created: 0, skipped };
    adapter.setSelection([...itemIds, ...folderIds]);

    useHistoryStore.getState().push({
      label: `Moved ${moved} item${moved === 1 ? "" : "s"}`,
      undo: async () => {
        // One call per origin: moveItems takes a single destination folder+vault.
        for (const id of itemIds) {
          const origin = originOf(id);
          await adapter.moveItems([id], origin.folderId, origin.vaultId);
        }
        for (const id of folderIds) {
          const origin = originOf(id);
          await adapter.moveFolder(id, origin.folderId, origin.vaultId);
        }
      },
      redo: async () => {
        if (itemIds.length > 0) await adapter.moveItems(itemIds, target, targetVault);
        for (const id of folderIds) await adapter.moveFolder(id, target, targetVault);
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
