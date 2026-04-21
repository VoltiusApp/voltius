import { create } from "zustand";
import type { Folder, FolderFormData } from "@/types";
import * as api from "@/services/folders";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";

interface FolderStore {
  folders: Folder[];
  loading: boolean;
  loadFolders: () => Promise<void>;
  saveFolder: (data: FolderFormData) => Promise<Folder>;
  updateFolder: (id: string, data: FolderFormData) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveObjectsToFolder: (
    objectIds: string[],
    objectType: "connection" | "identity" | "key",
    folderId: string | null,
  ) => Promise<void>;
  moveFolder: (id: string, parentFolderId: string | null) => Promise<void>;
}

export const useFolderStore = create<FolderStore>((set, get) => ({
  folders: [],
  loading: false,

  loadFolders: async () => {
    set({ loading: true });
    const folders = await api.listFolders();
    set({ folders, loading: false });
  },

  saveFolder: async (data) => {
    const folder = await api.saveFolder(data);
    const folders = await api.listFolders();
    set({ folders });
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isTypeSynced("folder")) scheduleSync(); });
    let recreatedId: string | null = null;
    useHistoryStore.getState().push({
      label: `Created folder "${folder.name}"`,
      undo: async () => {
        await useFolderStore.getState().deleteFolder(recreatedId ?? folder.id);
        recreatedId = null;
      },
      redo: async () => {
        const r = await useFolderStore.getState().saveFolder(data);
        recreatedId = r.id;
      },
    });
    return folder;
  },

  updateFolder: async (id, data) => {
    const prev = get().folders.find((f) => f.id === id);
    await api.updateFolder(id, data);
    const folders = await api.listFolders();
    set({ folders });
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isObjectSynced(id, "folder")) scheduleSync(); });
    if (prev) {
      const prevData: FolderFormData = {
        name: prev.name,
        object_type: prev.object_type,
        parent_folder_id: prev.parent_folder_id,
        vault_id: prev.vault_id,
        color: prev.color,
        icon: prev.icon,
      };
      useHistoryStore.getState().push({
        label: `Updated folder "${prev.name}"`,
        undo: async () => { await useFolderStore.getState().updateFolder(id, prevData); },
        redo: async () => { await useFolderStore.getState().updateFolder(id, data); },
      });
    }
  },

  deleteFolder: async (id) => {
    const prev = get().folders.find((f) => f.id === id);
    await api.deleteFolder(id);
    const folders = await api.listFolders();
    set({ folders });
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isObjectSynced(id, "folder")) scheduleSync(); });
    if (prev) {
      const prevData: FolderFormData = {
        name: prev.name,
        object_type: prev.object_type,
        parent_folder_id: prev.parent_folder_id,
        vault_id: prev.vault_id,
        color: prev.color,
        icon: prev.icon,
      };
      let recreatedId: string | null = null;
      useHistoryStore.getState().push({
        label: `Deleted folder "${prev.name}"`,
        undo: async () => {
          const r = await useFolderStore.getState().saveFolder(prevData);
          recreatedId = r.id;
        },
        redo: async () => {
          await useFolderStore.getState().deleteFolder(recreatedId ?? id);
          recreatedId = null;
        },
      });
    }
  },

  moveObjectsToFolder: async (objectIds, objectType, folderId) => {
    const prevFolderIds = new Map<string, string | null>();
    if (objectType === "connection") {
      const conns = useConnectionStore.getState().connections;
      objectIds.forEach((oid) => {
        const c = conns.find((c) => c.id === oid);
        prevFolderIds.set(oid, c?.folder_id ?? null);
      });
    } else if (objectType === "key") {
      const keys = useKeyStore.getState().keys;
      objectIds.forEach((oid) => {
        const k = keys.find((k) => k.id === oid);
        prevFolderIds.set(oid, k?.folder_id ?? null);
      });
    } else if (objectType === "identity") {
      const identities = useIdentityStore.getState().identities;
      objectIds.forEach((oid) => {
        const i = identities.find((i) => i.id === oid);
        prevFolderIds.set(oid, i?.folder_id ?? null);
      });
    }
    await api.moveObjectsToFolder(objectIds, objectType, folderId);
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isTypeSynced("folder")) scheduleSync(); });
    useHistoryStore.getState().push({
      label: `Moved ${objectIds.length} ${objectType}(s) to folder`,
      undo: async () => {
        const groups = new Map<string | null, string[]>();
        prevFolderIds.forEach((prevId, oid) => {
          if (!groups.has(prevId)) groups.set(prevId, []);
          groups.get(prevId)!.push(oid);
        });
        for (const [prevFolderId, ids] of groups) {
          await useFolderStore.getState().moveObjectsToFolder(ids, objectType, prevFolderId);
        }
      },
      redo: async () => { await useFolderStore.getState().moveObjectsToFolder(objectIds, objectType, folderId); },
    });
  },

  moveFolder: async (id, parentFolderId) => {
    const folder = get().folders.find((f) => f.id === id);
    if (!folder) return;
    const prevParentId = folder.parent_folder_id ?? null;
    await api.updateFolder(id, {
      name: folder.name,
      object_type: folder.object_type,
      parent_folder_id: parentFolderId ?? undefined,
      vault_id: folder.vault_id,
    });
    const folders = await api.listFolders();
    set({ folders });
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isObjectSynced(id, "folder")) scheduleSync(); });
    useHistoryStore.getState().push({
      label: `Moved folder "${folder.name}"`,
      undo: async () => { await useFolderStore.getState().moveFolder(id, prevParentId); },
      redo: async () => { await useFolderStore.getState().moveFolder(id, parentFolderId); },
    });
  },
}));
