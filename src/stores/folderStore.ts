import { create } from "zustand";
import type { Folder, FolderFormData } from "@/types";
import * as api from "@/services/folders";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { reportAuditMutation } from "@/services/auditMutations";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { removeTeamVaultObject, saveTeamVaultObject } from "@/services/teamObjectPersistence";
import { classifyVaultTransition, migrateVaultObject } from "@/services/teamVaultMigration";
import { useTeamStore } from "@/stores/teamStore";

function isTeamVaultId(vaultId: string | null | undefined): vaultId is string {
  if (!vaultId) return false;
  return useTeamStore.getState().teams.some((t) => t.id === vaultId);
}

function upsert(arr: Folder[], item: Folder): Folder[] {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...arr, item];
  const next = [...arr];
  next[idx] = item;
  return next;
}

function findTeamEntry(
  teamMap: Record<string, Folder[]>,
  id: string,
): { teamId: string; item: Folder } | null {
  for (const [teamId, items] of Object.entries(teamMap)) {
    const item = items.find((x) => x.id === id);
    if (item) return { teamId, item };
  }
  return null;
}

interface FolderStore {
  folders: Folder[];
  loading: boolean;
  teamFolders: Record<string, Folder[]>;
  loadFolders: () => Promise<void>;
  setTeamFolders: (teamId: string, items: Folder[]) => void;
  clearTeamFolders: (teamId?: string) => void;
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
  teamFolders: {},

  loadFolders: async () => {
    set({ loading: true });
    const folders = await api.listFolders();
    set({ folders, loading: false });
  },

  setTeamFolders: (teamId, items) =>
    set((s) => ({ teamFolders: { ...s.teamFolders, [teamId]: items } })),

  clearTeamFolders: (teamId) =>
    set((s) => {
      if (teamId === undefined) return { teamFolders: {} };
      const next = { ...s.teamFolders };
      delete next[teamId];
      return { teamFolders: next };
    }),

  saveFolder: async (data) => {
    if (data.vault_id) {
      const { useTeamStore } = await import("@/stores/teamStore");
      if (useTeamStore.getState().teams.some((t) => t.id === data.vault_id)) {
        const now = new Date().toISOString();
        const folder: Folder = {
          id: crypto.randomUUID(),
          name: data.name,
          object_type: data.object_type,
          parent_folder_id: data.parent_folder_id,
          vault_id: data.vault_id,
          color: data.color,
          icon: data.icon,
          created_at: now,
          updated_at: now,
          clocks: { created_at: now, updated_at: now },
        };
        const vaultId = data.vault_id;
        await saveTeamVaultObject(vaultId, "folder", folder);
        set((s) => ({
          teamFolders: {
            ...s.teamFolders,
            [vaultId]: upsert(s.teamFolders[vaultId] ?? [], folder),
          },
        }));
        reportAuditMutation("folder", "created", { id: folder.id, name: folder.name, vault_id: folder.vault_id }, { object_type: folder.object_type });
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
      }
    }

    const folder = await api.saveFolder(data);
    const folders = await api.listFolders();
    set({ folders });
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isTypeSynced("folder")) scheduleSync(); });
    reportAuditMutation("folder", "created", { id: folder.id, name: folder.name, vault_id: folder.vault_id }, { object_type: folder.object_type });
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
    const teamEntry = findTeamEntry(get().teamFolders, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      const now = new Date().toISOString();
      const updated: Folder = {
        ...prev,
        name: data.name,
        object_type: data.object_type,
        parent_folder_id: data.parent_folder_id,
        vault_id: data.vault_id ?? prev.vault_id,
        color: data.color,
        icon: data.icon,
        updated_at: now,
        clocks: { ...prev.clocks, updated_at: now },
      };
      const migrated = await migrateVaultObject({
        previousVaultId: teamId,
        nextVaultId: updated.vault_id,
        isTeamVaultId,
        item: updated,
        updateLocal: () => api.updateFolder(id, data).then(() => updated),
        saveTeam: (tid, item) => saveTeamVaultObject(tid, "folder", item),
        removeTeam: removeTeamVaultObject,
      });
      const transition = classifyVaultTransition(teamId, migrated.vault_id, isTeamVaultId);
      const localFolders = transition.kind === "team-to-local" ? await api.listFolders() : undefined;
      set((s) => {
        const nextTeamFolders = { ...s.teamFolders };
        if (transition.kind === "team-to-team") {
          nextTeamFolders[transition.sourceTeamId] = (nextTeamFolders[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
          nextTeamFolders[transition.destinationTeamId] = upsert(nextTeamFolders[transition.destinationTeamId] ?? [], migrated);
          return { teamFolders: nextTeamFolders };
        }
        if (transition.kind === "team-to-local") {
          nextTeamFolders[transition.sourceTeamId] = (nextTeamFolders[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
          return { folders: localFolders, teamFolders: nextTeamFolders };
        }
        nextTeamFolders[teamId] = upsert(nextTeamFolders[teamId] ?? [], migrated);
        return { teamFolders: nextTeamFolders };
      });
      reportAuditMutation("folder", "updated", { id: migrated.id, name: migrated.name, vault_id: migrated.vault_id }, { object_type: migrated.object_type });
      const prevData: FolderFormData = {
        name: prev.name, object_type: prev.object_type,
        parent_folder_id: prev.parent_folder_id, vault_id: prev.vault_id,
        color: prev.color, icon: prev.icon,
      };
      useHistoryStore.getState().push({
        label: `Updated folder "${prev.name}"`,
        undo: async () => { await useFolderStore.getState().updateFolder(id, prevData); },
        redo: async () => { await useFolderStore.getState().updateFolder(id, data); },
      });
      return;
    }

    const prev = get().folders.find((f) => f.id === id);
    let updated: Folder | undefined;
    if (prev) {
      const nextVaultId = data.vault_id ?? prev.vault_id;
      updated = await migrateVaultObject<Folder>({
        previousVaultId: prev.vault_id,
        nextVaultId,
        isTeamVaultId,
        item: { ...prev, ...data, vault_id: nextVaultId } as Folder,
        updateLocal: () => api.updateFolder(id, data).then(() => ({ ...prev, ...data, vault_id: nextVaultId } as Folder)),
        saveTeam: (teamId, item) => saveTeamVaultObject(teamId, "folder", item),
        removeTeam: removeTeamVaultObject,
      });
    } else {
      await api.updateFolder(id, data);
    }
    const folders = await api.listFolders();
    set((s) => {
      const nextTeamFolders = { ...s.teamFolders };
      if (prev && updated) {
        const transition = classifyVaultTransition(prev.vault_id, updated.vault_id, isTeamVaultId);
        if (transition.kind === "local-to-team") {
          nextTeamFolders[transition.destinationTeamId] = upsert(nextTeamFolders[transition.destinationTeamId] ?? [], updated);
        } else if (transition.kind === "team-to-team") {
          nextTeamFolders[transition.sourceTeamId] = (nextTeamFolders[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
          nextTeamFolders[transition.destinationTeamId] = upsert(nextTeamFolders[transition.destinationTeamId] ?? [], updated);
        } else if (transition.kind === "team-to-local") {
          nextTeamFolders[transition.sourceTeamId] = (nextTeamFolders[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
        }
      }
      return { folders, teamFolders: nextTeamFolders };
    });
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isObjectSynced(id, "folder")) scheduleSync(); });
    if (prev) reportAuditMutation("folder", "updated", { id, name: data.name ?? prev.name, vault_id: data.vault_id ?? prev.vault_id }, { object_type: data.object_type ?? prev.object_type });
    if (prev) {
      const prevData: FolderFormData = {
        name: prev.name, object_type: prev.object_type,
        parent_folder_id: prev.parent_folder_id, vault_id: prev.vault_id,
        color: prev.color, icon: prev.icon,
      };
      useHistoryStore.getState().push({
        label: `Updated folder "${prev.name}"`,
        undo: async () => { await useFolderStore.getState().updateFolder(id, prevData); },
        redo: async () => { await useFolderStore.getState().updateFolder(id, data); },
      });
    }
  },

  deleteFolder: async (id) => {
    const teamEntry = findTeamEntry(get().teamFolders, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      await removeTeamVaultObject(teamId, id);
      set((s) => ({
        teamFolders: {
          ...s.teamFolders,
          [teamId]: (s.teamFolders[teamId] ?? []).filter((x) => x.id !== id),
        },
      }));
      reportAuditMutation("folder", "deleted", { id: prev.id, name: prev.name, vault_id: prev.vault_id }, { object_type: prev.object_type });
      const prevData: FolderFormData = {
        name: prev.name, object_type: prev.object_type,
        parent_folder_id: prev.parent_folder_id, vault_id: prev.vault_id,
        color: prev.color, icon: prev.icon,
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
      return;
    }

    const prev = get().folders.find((f) => f.id === id);
    await api.deleteFolder(id);
    const folders = await api.listFolders();
    set({ folders });
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isObjectSynced(id, "folder")) scheduleSync(); });
    if (prev) reportAuditMutation("folder", "deleted", { id: prev.id, name: prev.name, vault_id: prev.vault_id }, { object_type: prev.object_type });
    if (prev) {
      const prevData: FolderFormData = {
        name: prev.name, object_type: prev.object_type,
        parent_folder_id: prev.parent_folder_id, vault_id: prev.vault_id,
        color: prev.color, icon: prev.icon,
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
    const teamEntry = findTeamEntry(get().teamFolders, id);
    if (teamEntry) {
      const { teamId, item: folder } = teamEntry;
      const prevParentId = folder.parent_folder_id ?? null;
      const now = new Date().toISOString();
      const updated: Folder = {
        ...folder,
        parent_folder_id: parentFolderId ?? undefined,
        updated_at: now,
        clocks: { ...folder.clocks, updated_at: now },
      };
      await saveTeamVaultObject(teamId, "folder", updated);
      set((s) => ({
        teamFolders: {
          ...s.teamFolders,
          [teamId]: upsert(s.teamFolders[teamId] ?? [], updated),
        },
      }));
      useHistoryStore.getState().push({
        label: `Moved folder "${folder.name}"`,
        undo: async () => { await useFolderStore.getState().moveFolder(id, prevParentId); },
        redo: async () => { await useFolderStore.getState().moveFolder(id, parentFolderId); },
      });
      return;
    }

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
