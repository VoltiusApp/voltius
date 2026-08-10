import type { Folder } from "@/types";
import type { NavItem } from "@/stores/uiStore";
import type { VaultClipboardKind } from "@/stores/vaultClipboardStore";
import type { PageClipboardAdapter } from "@/hooks/usePageClipboard";
import type { Permission } from "@/hooks/usePermission";
import { descendantFolders } from "@/utils/folderTree";
import { folderNameIsFree } from "@/utils/cloneName";

/** The minimum a page's objects have to expose to be cut, copied and pasted. */
interface ClipboardItem {
  id: string;
  vault_id?: string | null;
  folder_id?: string | null;
}

interface ClipboardEntity {
  kind: VaultClipboardKind;
  /** Searched in order, so a page whose kinds share an id space keeps its precedence. */
  items: ClipboardItem[];
}

interface VaultClipboardBaseInput {
  navItem: NavItem;
  entities: ClipboardEntity[];
  /** The folders the page can see. */
  folders: Folder[];
  selectedIdSet: Set<string>;
  focusedId: string | null;
  activeFolderId: string | null;
  /** The one vault the view is scoped to, null when several are on screen. */
  scopedVaultId: string | null;
  accessibleVaultIds: string[];
  vaultOptions: { id: string; name: string }[];
  can: (permission: Permission, vaultId: string) => boolean;
  confirmCrossVault: PageClipboardAdapter["confirmCrossVault"];
  setSelection: (ids: string[]) => void;
  /** Carries a folder subtree, contents included, into another vault. */
  migrateFolderTreeToVault: (
    folder: Folder,
    parentFolderId: string | null,
    vaultId: string,
  ) => Promise<void>;
  moveFolder: (id: string, parentFolderId: string | null) => Promise<unknown>;
  copyFolderInto: (
    folderId: string,
    parentFolderId: string | null,
    vaultId?: string,
    opts?: { keepName?: boolean },
  ) => Promise<{ id: string }>;
  deleteFolder: (id: string) => Promise<unknown>;
}

/** The adapter fields whose shape is the page's own — what this does NOT build. */
type PageSpecific =
  | "folderContentKinds"
  | "danglingKinds"
  | "planCascade"
  | "applyCascade"
  | "moveItems"
  | "duplicateItems"
  | "deleteItems";

interface VaultClipboardBase {
  /**
   * A destination folder carries its own vault. At the root there is none, so the
   * view's scope answers instead: with a single vault on screen its root IS that
   * vault's root and a paste there belongs in it. With several on screen the root
   * names no destination, so every object keeps its own vault — matching the
   * drag-to-root path, and avoiding a "move to top level" gesture silently pulling
   * a subtree out of a team vault. Derived from the folder argument rather than
   * activeFolderId so an undo, which passes the origin folder back in, migrates
   * back to the vault it came from.
   */
  vaultForFolder: (folderId: string | null) => string | null;
  adapter: Omit<PageClipboardAdapter, PageSpecific>;
}

/**
 * Everything the four vault-object pages answer the same way: which id is what,
 * where it lives, and how a folder moves or clones. Each page still supplies what
 * only it knows — how its own objects move, clone and delete, and what a paste of
 * them would leave dangling.
 */
export function vaultClipboardBase({
  navItem,
  entities,
  folders,
  selectedIdSet,
  focusedId,
  activeFolderId,
  scopedVaultId,
  accessibleVaultIds,
  vaultOptions,
  can,
  confirmCrossVault,
  setSelection,
  migrateFolderTreeToVault,
  moveFolder,
  copyFolderInto,
  deleteFolder,
}: VaultClipboardBaseInput): VaultClipboardBase {
  const itemOf = (id: string): ClipboardItem | undefined => {
    for (const entity of entities) {
      const found = entity.items.find((i) => i.id === id);
      if (found) return found;
    }
    return undefined;
  };
  const folderOf = (id: string) => folders.find((f) => f.id === id);

  const vaultForFolder = (folderId: string | null): string | null =>
    folderId ? (folderOf(folderId)?.vault_id ?? null) : scopedVaultId;

  return {
    vaultForFolder,
    adapter: {
      navItem,
      getSelection: () => [...selectedIdSet],
      getFocusedId: () => focusedId,
      classify: (id) => {
        if (folderOf(id)) return "folder";
        return entities.find((e) => e.items.some((i) => i.id === id))?.kind ?? null;
      },
      exists: (id) => !!itemOf(id) || !!folderOf(id),
      vaultIdOf: (id) => itemOf(id)?.vault_id ?? folderOf(id)?.vault_id ?? "personal",
      targetFolderId: () => activeFolderId,
      rootVaultIds: () => accessibleVaultIds,
      targetVaultId: () => vaultForFolder(activeFolderId),
      targetVaultName: () =>
        vaultOptions.find((v) => v.id === vaultForFolder(activeFolderId))?.name ?? "",
      confirmCrossVault,
      folderIdOf: (id) => itemOf(id)?.folder_id ?? folderOf(id)?.parent_folder_id ?? null,
      canMoveFolder: (id, parentFolderId) =>
        parentFolderId !== id
        && !(parentFolderId !== null && descendantFolders(folders, id).some((f) => f.id === parentFolderId)),
      can: (permission, vaultId) => can(permission as Permission, vaultId),
      // A same-vault move only reparents; a cross-vault one has to carry the whole
      // subtree, otherwise it would keep a stale vault_id alongside its new folder's.
      moveFolder: async (id, parentFolderId, vaultId) => {
        const folder = folderOf(id);
        if (!folder) return;
        if (vaultId !== null && (folder.vault_id ?? "personal") !== vaultId) {
          await migrateFolderTreeToVault(folder, parentFolderId, vaultId);
          return;
        }
        await moveFolder(id, parentFolderId);
      },
      duplicateFolder: async (id, parentFolderId) => {
        const targetVault = vaultForFolder(parentFolderId);
        const folder = folderOf(id);
        return (
          await copyFolderInto(id, parentFolderId, targetVault ?? undefined, {
            keepName: folderNameIsFree(
              folders,
              folder?.name,
              targetVault ?? folder?.vault_id ?? "personal",
              parentFolderId,
            ),
          })
        ).id;
      },
      deleteFolder: async (id) => { await deleteFolder(id); },
      setSelection,
    },
  };
}
