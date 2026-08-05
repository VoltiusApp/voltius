import type { NavItem } from "@/stores/uiStore";
import type { VaultClipboard, VaultClipboardKind } from "@/stores/vaultClipboardStore";
import { useHistoryStore } from "@/stores/historyStore";
import i18n from "@/i18n";

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
  /**
   * Vaults the root listing currently shows. Only used to tell a root paste that
   * silently drops an object — its vault is not one of these — apart from the
   * ordinary no-op of pasting an object back where it already sits.
   */
  rootVaultIds?: () => string[];
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
  /** A root paste left an object behind because it would have had to change vault. */
  crossVaultAtRoot?: boolean;
}

const EMPTY: PasteResult = { moved: 0, created: 0, skipped: 0 };

const EDIT_PERMISSION: Record<string, string> = {
  connection: "EDIT_CONNECTIONS",
  port_forward: "EDIT_CONNECTIONS",
  identity: "EDIT_IDENTITIES",
  key: "EDIT_KEYS",
  snippet: "EDIT_SNIPPETS",
};

interface VaultMove {
  /** Every permission the object carries across the boundary. */
  permissions: string[];
  sourceVaultId: string | null;
  destinationVaultId: string | null;
  /** A move also deletes from the source, so the source must authorize too. */
  removesFromSource: boolean;
}

const itemPermissions = (kind: string): string[] => [EDIT_PERMISSION[kind] ?? "EDIT_CONNECTIONS"];

// The folder's contents cross the vault boundary with it.
const folderPermissions = (adapter: ClipboardAdapter, id: string): string[] => [
  "EDIT_FOLDERS",
  ...adapter.folderContentKinds(id).map((kind) => EDIT_PERMISSION[kind] ?? "EDIT_CONNECTIONS"),
];

/**
 * A cross-vault move is two authorizations — a write on the destination and a
 * delete on the source — issued as separate calls. Both are checked here so a
 * permitted write cannot be followed by a refused delete, which would leave a
 * duplicate where the user asked for a move. The server remains the boundary;
 * this only stops a move that is already known to fail. Undo and redo are each a
 * cross-vault move of their own, with their own source and destination, so they
 * go through the same check before mutating anything.
 */
function blockedForMoves(adapter: ClipboardAdapter, moves: VaultMove[]): string[] {
  const blocked = new Set<string>();
  for (const move of moves) {
    const { sourceVaultId: source, destinationVaultId: destination } = move;
    // A null destination leaves every object in the vault it has.
    if (destination === null || source === destination) continue;
    for (const permission of move.permissions) {
      if (!adapter.can(permission, destination)) blocked.add(permission);
      if (move.removesFromSource && source !== null && !adapter.can(permission, source)) {
        blocked.add(permission);
      }
    }
  }
  return [...blocked];
}

/** Permissions needed to delete objects from the vaults they currently sit in. */
function blockedForDeletes(
  adapter: ClipboardAdapter,
  targets: { id: string; permissions: string[] }[],
): string[] {
  const blocked = new Set<string>();
  for (const target of targets) {
    if (!adapter.exists(target.id)) continue;
    const vaultId = adapter.vaultIdOf(target.id);
    for (const permission of target.permissions) {
      if (!adapter.can(permission, vaultId)) blocked.add(permission);
    }
  }
  return [...blocked];
}

/**
 * Undo and redo have no result to report a refusal through, so a refused one
 * throws: historyStore restores the entry and raises its failure toast, leaving
 * the action retriable once the permission comes back.
 */
function refuse(blocked: string[]): void {
  if (blocked.length === 0) return;
  const permissions = blocked.map((p) => i18n.t(`members.permission.${p}`)).join(", ");
  throw new Error(i18n.t("common.clipboard.permissionsMissing", { permissions }));
}

function pasteMoves(
  clipboard: NonNullable<VaultClipboard>,
  adapter: ClipboardAdapter,
  liveItems: { id: string; kind: string }[],
  liveFolders: string[],
  destinationVaultId: string | null,
): VaultMove[] {
  const removesFromSource = clipboard.mode === "cut";
  return [
    ...liveItems.map((item) => ({
      permissions: itemPermissions(item.kind),
      sourceVaultId: adapter.vaultIdOf(item.id),
      destinationVaultId,
      removesFromSource,
    })),
    ...liveFolders.map((id) => ({
      permissions: folderPermissions(adapter, id),
      sourceVaultId: adapter.vaultIdOf(id),
      destinationVaultId,
      removesFromSource,
    })),
  ];
}

/**
 * A root paste carries no destination vault, so every object keeps the one it has.
 * An object cut from a root of a vault the destination root does not even show is
 * therefore dropped: same folder (null), unreachable vault, nothing to do. That is
 * indistinguishable from a broken Ctrl+V, so it is reported.
 */
function strandsAtRoot(
  adapter: ClipboardAdapter,
  target: string | null,
  ids: string[],
): boolean {
  if (target !== null) return false;
  const rootVaults = adapter.rootVaultIds?.() ?? [];
  if (rootVaults.length === 0) return false;
  return ids.some(
    (id) => adapter.folderIdOf(id) === null && !rootVaults.includes(adapter.vaultIdOf(id)),
  );
}

export async function pasteFromClipboard(
  clipboard: VaultClipboard,
  adapter: ClipboardAdapter,
): Promise<PasteResult> {
  if (!clipboard || clipboard.tab !== adapter.navItem) return EMPTY;

  const target = adapter.targetFolderId();
  const targetVault = adapter.targetVaultId();
  const liveItems = clipboard.items.filter((i) => adapter.exists(i.id));
  const liveFolders = clipboard.folderIds.filter((id) => adapter.exists(id));
  const skipped =
    clipboard.items.length - liveItems.length + (clipboard.folderIds.length - liveFolders.length);

  if (liveItems.length === 0 && liveFolders.length === 0) {
    return { ...EMPTY, skipped };
  }

  const blocked = blockedForMoves(
    adapter,
    pasteMoves(clipboard, adapter, liveItems, liveFolders, targetVault),
  );
  if (blocked.length > 0) return { ...EMPTY, skipped, blocked };

  if (clipboard.mode === "cut") {
    const crossVaultAtRoot = strandsAtRoot(adapter, target, [
      ...liveItems.map((i) => i.id),
      ...liveFolders,
    ]);
    const itemIds = liveItems.map((i) => i.id).filter((id) => adapter.folderIdOf(id) !== target);
    const folderIds = liveFolders.filter(
      (id) => adapter.folderIdOf(id) !== target && adapter.canMoveFolder(id, target),
    );
    // The origin vault is recorded alongside the origin folder: an object cut from
    // a vault root has no origin folder to read its vault back from at undo time.
    const origins = new Map<string, { folderId: string | null; vaultId: string }>();
    for (const id of [...itemIds, ...folderIds]) {
      origins.set(id, { folderId: adapter.folderIdOf(id), vaultId: adapter.vaultIdOf(id) });
    }
    const originOf = (id: string) => origins.get(id) ?? { folderId: null, vaultId: null };
    const kindOf = new Map(liveItems.map((i) => [i.id, i.kind]));
    // Read at undo/redo time, not paste time: the source is wherever the object
    // sits now, and the permission may have been revoked since.
    const movesTo = (destination: (id: string) => string | null): VaultMove[] => [
      ...itemIds.map((id) => ({
        permissions: itemPermissions(kindOf.get(id) ?? "connection"),
        sourceVaultId: adapter.vaultIdOf(id),
        destinationVaultId: destination(id),
        removesFromSource: true,
      })),
      ...folderIds.map((id) => ({
        permissions: folderPermissions(adapter, id),
        sourceVaultId: adapter.vaultIdOf(id),
        destinationVaultId: destination(id),
        removesFromSource: true,
      })),
    ];

    // Suppressed: each store method records its own entry, and undoing those
    // stale entries after the composite undo has already run throws on team
    // vaults, which wedges the history stack.
    await useHistoryStore.getState().withoutHistory(async () => {
      if (itemIds.length > 0) await adapter.moveItems(itemIds, target, targetVault);
      for (const id of folderIds) await adapter.moveFolder(id, target, targetVault);
    });
    const moved = itemIds.length + folderIds.length;
    if (moved === 0) return { moved: 0, created: 0, skipped, crossVaultAtRoot };
    adapter.setSelection([...itemIds, ...folderIds]);

    useHistoryStore.getState().push({
      label: `Moved ${moved} item${moved === 1 ? "" : "s"}`,
      undo: async () => {
        refuse(blockedForMoves(adapter, movesTo((id) => originOf(id).vaultId)));
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
        refuse(blockedForMoves(adapter, movesTo(() => targetVault)));
        if (itemIds.length > 0) await adapter.moveItems(itemIds, target, targetVault);
        for (const id of folderIds) await adapter.moveFolder(id, target, targetVault);
      },
    });
    return { moved, created: 0, skipped, crossVaultAtRoot };
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
      refuse(
        blockedForDeletes(adapter, [
          ...createdItemIds.map((id, i) => ({
            id,
            permissions: itemPermissions(liveItems[i]?.kind ?? "connection"),
          })),
          ...createdFolderIds.map((id) => ({ id, permissions: folderPermissions(adapter, id) })),
        ]),
      );
      if (createdItemIds.length > 0) await adapter.deleteItems(createdItemIds);
      for (const id of createdFolderIds) await adapter.deleteFolder(id);
    },
    // Redo re-creates under fresh ids, so the holders must be refreshed for the
    // next undo to delete the right objects.
    redo: async () => {
      refuse(
        blockedForMoves(
          adapter,
          pasteMoves(clipboard, adapter, liveItems, liveFolders, targetVault),
        ),
      );
      const again = await duplicateAll();
      createdItemIds = again.items;
      createdFolderIds = again.folders;
    },
  });
  return { moved: 0, created, skipped };
}
