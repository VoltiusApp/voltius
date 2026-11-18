import type { Folder } from "@/types";
import type { NavItem } from "@/stores/uiStore";
import type { VaultClipboardKind } from "@/stores/vaultClipboardStore";
import type { Permission } from "@/hooks/usePermission";
import type { PageClipboardAdapter } from "@/hooks/usePageClipboard";
import { descendantFolders, itemsInFolderSubtree } from "@/utils/folderTree";
import { cloneFolderTree } from "@/utils/folderCopy";
import { moveFolderTreeToVault } from "@/utils/folderMove";
import { folderNameIsFree, nameIsFree } from "@/utils/cloneName";
import {
  findObject,
  linksDiffer,
  objectsOfKind,
  planReferenceCascade,
  refKey,
  relinkedFields,
  vaultOfObject,
  type ObjectRef,
  type RemapTable,
  type VaultObject,
} from "@/services/vaultObjectRefs";
import { catalogueOf, vaultObjectWrites, type VaultObjectPorts } from "@/services/vaultObjectWrites";

export type VaultObjectTab = "hosts" | "keychain" | "port-forwarding" | "snippets";

/** The kinds a tab lists, in the order its ids are classified. */
export const TAB_KINDS: Record<VaultObjectTab, VaultClipboardKind[]> = {
  hosts: ["connection"],
  keychain: ["key", "identity"],
  "port-forwarding": ["port_forward"],
  snippets: ["snippet"],
};

const FOLDER_TYPE: Record<Exclude<VaultObjectTab, "snippets">, string> = {
  hosts: "connection",
  keychain: "keychain",
  "port-forwarding": "port_forwarding",
};

/** What a paste copied, so later writes can point at the copies. Owned by the caller:
 *  a page re-renders mid-paste and rebuilds the adapter. */
export interface PasteState {
  remap: RemapTable;
  copies: ObjectRef[];
  /** Only a paste's own writes relink: an undo or redo moves objects as they stand. */
  active: boolean;
}

export const createPasteState = (): PasteState => ({ remap: new Map(), copies: [], active: false });

export interface VaultObjectsAdapterInput {
  tab: VaultObjectTab;
  ports: VaultObjectPorts;
  state: PasteState;
  selectedIds: string[];
  focusedId: string | null;
  /** Destination folder, null at the root. */
  activeFolderId: string | null;
  /** The one vault the view is scoped to, null when several are on screen. */
  scopedVaultId: string | null;
  accessibleVaultIds: string[];
  vaultOptions: { id: string; name: string }[];
  can: (permission: Permission, vaultId: string, objectId?: string) => boolean;
  confirmCrossVault: PageClipboardAdapter["confirmCrossVault"];
  setSelection: (ids: string[]) => void;
  hydrate?: () => Promise<void>;
}

interface Item {
  kind: VaultClipboardKind;
  obj: VaultObject;
}

export function vaultObjectsAdapter(input: VaultObjectsAdapterInput): PageClipboardAdapter {
  const { tab, ports, state } = input;
  const kinds = TAB_KINDS[tab];
  const writes = vaultObjectWrites(ports);
  const cat = () => catalogueOf(ports);
  const folders = (): Folder[] =>
    tab === "snippets" ? ports.snippetFolders() : ports.folders().filter((f) => f.object_type === FOLDER_TYPE[tab]);
  const folderStore = tab === "snippets"
    ? { save: ports.saveSnippetFolder, update: ports.updateSnippetFolder, move: ports.moveSnippetFolder, remove: ports.deleteSnippetFolder }
    : { save: ports.saveFolder, update: ports.updateFolder, move: ports.moveFolder, remove: ports.deleteFolder };

  const itemOf = (id: string): Item | undefined => {
    const c = cat();
    for (const kind of kinds) {
      const obj = findObject(c, { kind, id });
      if (obj) return { kind, obj };
    }
    return undefined;
  };
  const folderOf = (id: string) => folders().find((f) => f.id === id);
  const vaultForFolder = (folderId: string | null): string | null =>
    folderId ? (folderOf(folderId)?.vault_id ?? null) : input.scopedVaultId;

  const subtreeItems = (folderId: string): Item[] => {
    const c = cat();
    const tree = folders();
    return kinds.flatMap((kind) =>
      itemsInFolderSubtree(objectsOfKind(c, kind), tree, folderId).map((obj) => ({ kind, obj })));
  };
  const roots = (items: ObjectRef[], folderIds: string[]): ObjectRef[] => [
    ...items.map(({ kind, id }) => ({ kind, id })),
    ...folderIds.flatMap((id) => subtreeItems(id).map(({ kind, obj }) => ({ kind, id: obj.id }))),
  ];
  const plan = (items: ObjectRef[], folderIds: string[], destination: string, mode: "copy" | "cut") =>
    planReferenceCascade(cat(), roots(items, folderIds), destination, mode);

  const linksOf = (kind: VaultClipboardKind, obj: VaultObject) =>
    (state.active ? relinkedFields(kind, obj, state.remap) : {});

  const duplicateOne = async (kind: VaultClipboardKind, obj: VaultObject, folderId: string | null, vaultId: string, keepName: boolean) => {
    const id = await writes.duplicate(kind, obj, { vaultId, folderId, keepName, links: linksOf(kind, obj) });
    state.remap.set(refKey({ kind, id: obj.id }), id);
    state.copies.push({ kind, id });
    return id;
  };
  const moveOneToVault = (kind: VaultClipboardKind, obj: VaultObject, vaultId: string, folderId?: string | null) =>
    writes.moveToVault(kind, obj, { vaultId, folderId, links: linksOf(kind, obj) });

  return {
    navItem: tab as NavItem,
    getSelection: () => [...input.selectedIds],
    getFocusedId: () => input.focusedId,
    classify: (id) => (folderOf(id) ? "folder" : itemOf(id)?.kind ?? null),
    exists: (id) => !!itemOf(id) || !!folderOf(id),
    vaultIdOf: (id) => {
      const item = itemOf(id);
      return item ? vaultOfObject(item.obj) : folderOf(id)?.vault_id ?? "personal";
    },
    targetFolderId: () => input.activeFolderId,
    rootVaultIds: () => input.accessibleVaultIds,
    targetVaultId: () => vaultForFolder(input.activeFolderId),
    targetVaultName: () =>
      input.vaultOptions.find((v) => v.id === vaultForFolder(input.activeFolderId))?.name ?? "",
    vaultName: (vaultId) => input.vaultOptions.find((v) => v.id === vaultId)?.name ?? vaultId,
    hydrate: input.hydrate,
    confirmCrossVault: input.confirmCrossVault,
    folderIdOf: (id) => {
      const item = itemOf(id);
      return item ? item.obj.folder_id ?? null : folderOf(id)?.parent_folder_id ?? null;
    },
    canMoveFolder: (id, parentFolderId) =>
      parentFolderId !== id
      && !(parentFolderId !== null && descendantFolders(folders(), id).some((f) => f.id === parentFolderId)),
    can: (permission, vaultId, objectId) => input.can(permission as Permission, vaultId, objectId),
    setSelection: input.setSelection,

    folderContentKinds: (folderId) => [...new Set(subtreeItems(folderId).map((i) => i.kind))],
    danglingKinds: (items, folderIds, destination) =>
      [...new Set(plan(items, folderIds, destination, "copy").map((t) => t.kind))],
    planCascade: (items, folderIds, destination, mode) =>
      plan(items, folderIds, destination, mode).sort((a, b) => a.discovered - b.discovered).map((t) => ({
        type: t.kind, id: t.id, label: t.label, action: t.action, sourceVaultId: t.sourceVaultId,
      })),
    applyCascade: async (items, folderIds, destination, mode) => {
      for (const t of plan(items, folderIds, destination, mode)) {
        const obj = findObject(cat(), t);
        if (!obj) continue;
        if (t.action === "move") await moveOneToVault(t.kind, obj, destination, null);
        else await duplicateOne(t.kind, obj, null, destination, nameIsFree(objectsOfKind(cat(), t.kind), (obj as { name?: string }).name, destination, null));
      }
    },
    beginPaste: () => {
      state.remap.clear();
      state.copies.length = 0;
      state.active = true;
    },
    finishPaste: async () => {
      if (!state.active) return;
      state.active = false;
      for (const copy of state.copies) {
        const obj = findObject(cat(), copy);
        if (obj && linksDiffer(copy.kind, obj, state.remap)) {
          await writes.relink(copy.kind, obj, relinkedFields(copy.kind, obj, state.remap));
        }
      }
    },

    moveItems: async (ids, folderId, vaultId) => {
      const within = new Map<VaultClipboardKind, VaultObject[]>();
      for (const id of ids) {
        const item = itemOf(id);
        if (!item) continue;
        if (vaultId === null || vaultOfObject(item.obj) === vaultId) {
          within.set(item.kind, [...(within.get(item.kind) ?? []), item.obj]);
          continue;
        }
        await moveOneToVault(item.kind, item.obj, vaultId, folderId);
      }
      for (const [kind, objects] of within) await writes.moveWithinVault(kind, objects, folderId);
    },
    duplicateItems: async (ids, folderId, vaultId) => {
      const created: string[] = [];
      for (const id of ids) {
        const item = itemOf(id);
        if (!item) continue;
        const target = vaultId ?? vaultOfObject(item.obj);
        const name = (item.obj as { name?: string }).name;
        created.push(await duplicateOne(item.kind, item.obj, folderId, target,
          nameIsFree(objectsOfKind(cat(), item.kind), name, target, folderId)));
      }
      return created;
    },
    deleteItems: async (ids) => {
      for (const id of ids) {
        const item = itemOf(id);
        if (item) await writes.remove(item.kind, id);
      }
    },

    moveFolder: async (id, parentFolderId, vaultId) => {
      const folder = folderOf(id);
      if (!folder) return;
      if (vaultId === null || (folder.vault_id ?? "personal") === vaultId) {
        await folderStore.move(id, parentFolderId);
        return;
      }
      const contents = subtreeItems(id);
      await moveFolderTreeToVault({
        root: folder, subFolders: descendantFolders(folders(), id), parentFolderId, vaultId, updateFolder: folderStore.update,
      });
      for (const { kind, obj } of contents) await moveOneToVault(kind, obj, vaultId);
    },
    duplicateFolder: async (id, parentFolderId, vaultId) => {
      const folder = folderOf(id);
      if (!folder) throw new Error(`Unknown folder ${id}`);
      const target = vaultId ?? folder.vault_id ?? "personal";
      const contents = subtreeItems(id);
      const { root, folderIdMap } = await cloneFolderTree({
        root: folder,
        subFolders: descendantFolders(folders(), id),
        parentFolderId,
        vaultId: target,
        keepName: folderNameIsFree(folders(), folder.name, target, parentFolderId),
        saveFolder: folderStore.save,
      });
      for (const { kind, obj } of contents) {
        await duplicateOne(kind, obj, folderIdMap.get(obj.folder_id ?? "") ?? root.id, target, true);
      }
      return root.id;
    },
    deleteFolder: async (id) => { await folderStore.remove(id); },
  };
}

/** The adapter with no page behind it: nothing selected, nothing to confirm, the destination given outright. */
export const headlessVaultObjectsAdapter = (input: Pick<VaultObjectsAdapterInput, "tab" | "ports" | "can"> & {
  folderId: string | null;
  vaultId: string | null;
  state?: PasteState;
  accessibleVaultIds?: string[];
  vaultOptions?: { id: string; name: string }[];
}): PageClipboardAdapter =>
  vaultObjectsAdapter({
    tab: input.tab,
    ports: input.ports,
    can: input.can,
    state: input.state ?? createPasteState(),
    selectedIds: [],
    focusedId: null,
    activeFolderId: input.folderId,
    scopedVaultId: input.vaultId,
    accessibleVaultIds: input.accessibleVaultIds ?? [],
    vaultOptions: input.vaultOptions ?? [],
    confirmCrossVault: undefined,
    setSelection: () => {},
  });
