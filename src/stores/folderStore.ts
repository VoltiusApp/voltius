import { create } from "zustand";
import type { Folder, FolderFormData } from "@/types";
import * as api from "@/services/folders";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { reportAuditMutation } from "@/services/auditMutations";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useHistoryStore } from "@/stores/historyStore";
import { pushCreateHistory } from "@/stores/recreateHistory";
import { useConnectionStore } from "@/stores/connectionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { folderSubtreeIds } from "@/utils/folderTree";
import { removeTeamVaultObject, saveTeamVaultObject } from "@/services/teamObjectPersistence";
import { classifyVaultTransition, migrateVaultObject } from "@/services/teamVaultMigration";
import { withPin } from "@/stores/withPin";
import { isTeamVaultId, upsertById, findTeamEntry, setTeamMapEntry, clearTeamMapEntry, upsertInTeamMap } from "@/stores/teamVaultMap";
import { useTeamObjectPrefsStore } from "@/stores/teamObjectPrefsStore";

interface FolderStore {
  folders: Folder[];
  loading: boolean;
  teamFolders: Record<string, Folder[]>;
  loadFolders: () => Promise<void>;
  setTeamFolders: (teamId: string, items: Folder[]) => void;
  clearTeamFolders: (teamId?: string) => void;
  saveFolder: (data: FolderFormData) => Promise<Folder>;
  updateFolder: (id: string, data: FolderFormData) => Promise<void>;
  deleteFolder: (id: string, opts?: { cascade?: boolean }) => Promise<void>;
  moveObjectsToFolder: (
    objectIds: string[],
    objectType: "connection" | "identity" | "key",
    folderId: string | null,
  ) => Promise<void>;
  moveFolder: (id: string, parentFolderId: string | null) => Promise<void>;
  pinFolder: (id: string, pinned: boolean | null) => Promise<void>;
  pinFolderForTeam: (id: string, pinned: boolean) => Promise<void>;
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
    set((s) => ({ teamFolders: setTeamMapEntry(s.teamFolders, teamId, items) })),

  clearTeamFolders: (teamId) =>
    set((s) => ({ teamFolders: clearTeamMapEntry(s.teamFolders, teamId) })),

  saveFolder: async (data) => {
    if (isTeamVaultId(data.vault_id)) {
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
      set((s) => ({ teamFolders: upsertInTeamMap(s.teamFolders, vaultId, folder) }));
      reportAuditMutation("folder", "created", { id: folder.id, name: folder.name, vault_id: folder.vault_id }, { object_type: folder.object_type });
      pushCreateHistory({
        label: `Created folder "${folder.name}"`,
        id: folder.id,
        data,
        create: (d) => useFolderStore.getState().saveFolder(d),
        // Non-cascading: undoing a *creation* must not delete items filed since.
        remove: (fid) => useFolderStore.getState().deleteFolder(fid, { cascade: false }),
      });
      return folder;
    }

    const folder = await api.saveFolder(data);
    const folders = await api.listFolders();
    set({ folders });
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isTypeSynced("folder")) scheduleSync(); });
    reportAuditMutation("folder", "created", { id: folder.id, name: folder.name, vault_id: folder.vault_id }, { object_type: folder.object_type });
    pushCreateHistory({
      label: `Created folder "${folder.name}"`,
      id: folder.id,
      data,
      create: (d) => useFolderStore.getState().saveFolder(d),
      // Non-cascading: undoing a *creation* must not delete items filed since.
      remove: (fid) => useFolderStore.getState().deleteFolder(fid, { cascade: false }),
    });
    return folder;
  },

  updateFolder: async (id, data) => {
    const teamEntry = findTeamEntry(get().teamFolders, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      const payload = withPin(data, prev);
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
        updateLocal: () => api.updateFolder(id, payload).then(() => updated),
        adoptLocal: () => api.adoptFolder(id, payload).then(() => updated),
        saveTeam: (tid, item) => saveTeamVaultObject(tid, "folder", item),
        removeTeam: removeTeamVaultObject,
      });
      const transition = classifyVaultTransition(teamId, migrated.vault_id, isTeamVaultId);
      const localFolders = transition.kind === "team-to-local" ? await api.listFolders() : undefined;
      set((s) => {
        const nextTeamFolders = { ...s.teamFolders };
        if (transition.kind === "team-to-team") {
          nextTeamFolders[transition.sourceTeamId] = (nextTeamFolders[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
          nextTeamFolders[transition.destinationTeamId] = upsertById(nextTeamFolders[transition.destinationTeamId] ?? [], migrated);
          return { teamFolders: nextTeamFolders };
        }
        if (transition.kind === "team-to-local") {
          nextTeamFolders[transition.sourceTeamId] = (nextTeamFolders[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
          return { folders: localFolders, teamFolders: nextTeamFolders };
        }
        nextTeamFolders[teamId] = upsertById(nextTeamFolders[teamId] ?? [], migrated);
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
      const payload = withPin(data, prev);
      updated = await migrateVaultObject<Folder>({
        previousVaultId: prev.vault_id,
        nextVaultId,
        isTeamVaultId,
        item: { ...prev, ...data, vault_id: nextVaultId } as Folder,
        updateLocal: () => api.updateFolder(id, payload).then(() => ({ ...prev, ...data, vault_id: nextVaultId } as Folder)),
        adoptLocal: () => api.adoptFolder(id, payload).then(() => ({ ...prev, ...data, vault_id: nextVaultId } as Folder)),
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
          nextTeamFolders[transition.destinationTeamId] = upsertById(nextTeamFolders[transition.destinationTeamId] ?? [], updated);
        } else if (transition.kind === "team-to-team") {
          nextTeamFolders[transition.sourceTeamId] = (nextTeamFolders[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
          nextTeamFolders[transition.destinationTeamId] = upsertById(nextTeamFolders[transition.destinationTeamId] ?? [], updated);
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

  // Cascade: the folder, its subfolders, and every item filed in them. Destructive
  // and deliberately not undoable — restoring would have to recreate items under new
  // ids, breaking the key/identity/connection references that point at them.
  deleteFolder: async (id, opts) => {
    const cascade = opts?.cascade !== false;
    const teamEntry = findTeamEntry(get().teamFolders, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      const teamFolders = get().teamFolders[teamId] ?? [];
      const doomed = cascade ? folderSubtreeIds(teamFolders, id) : new Set([id]);
      const inTree = <T extends { id: string; folder_id?: string | null }>(items: T[]) =>
        cascade ? items.filter((x) => x.folder_id != null && doomed.has(x.folder_id)) : [];

      const connections = inTree(useConnectionStore.getState().teamConnections[teamId] ?? []);
      const identities = inTree(useIdentityStore.getState().teamIdentities[teamId] ?? []);
      const keys = inTree(useKeyStore.getState().teamKeys[teamId] ?? []);
      const rules = inTree(usePortForwardingStore.getState().teamRules[teamId] ?? []);

      for (const item of [...connections, ...identities, ...keys, ...rules]) {
        await removeTeamVaultObject(teamId, item.id);
      }
      for (const folderId of doomed) {
        await removeTeamVaultObject(teamId, folderId);
      }

      const connectionIds = new Set(connections.map((c) => c.id));
      const identityIds = new Set(identities.map((i) => i.id));
      const keyIds = new Set(keys.map((k) => k.id));
      const ruleIds = new Set(rules.map((r) => r.id));
      useConnectionStore.setState((s) => ({
        teamConnections: { ...s.teamConnections, [teamId]: (s.teamConnections[teamId] ?? []).filter((x) => !connectionIds.has(x.id)) },
      }));
      useIdentityStore.setState((s) => ({
        teamIdentities: { ...s.teamIdentities, [teamId]: (s.teamIdentities[teamId] ?? []).filter((x) => !identityIds.has(x.id)) },
      }));
      useKeyStore.setState((s) => ({
        teamKeys: { ...s.teamKeys, [teamId]: (s.teamKeys[teamId] ?? []).filter((x) => !keyIds.has(x.id)) },
      }));
      usePortForwardingStore.setState((s) => ({
        teamRules: { ...s.teamRules, [teamId]: (s.teamRules[teamId] ?? []).filter((x) => !ruleIds.has(x.id)) },
      }));
      set((s) => ({
        teamFolders: {
          ...s.teamFolders,
          [teamId]: (s.teamFolders[teamId] ?? []).filter((x) => !doomed.has(x.id)),
        },
      }));
      reportAuditMutation("folder", "deleted", { id: prev.id, name: prev.name, vault_id: prev.vault_id }, { object_type: prev.object_type });
      return;
    }

    const prev = get().folders.find((f) => f.id === id);
    await api.deleteFolder(id, cascade);
    const folders = await api.listFolders();
    set({ folders });
    // The backend tombstoned items across four types; refresh them all.
    if (cascade) {
      await Promise.all([
        useConnectionStore.getState().loadConnections(),
        useIdentityStore.getState().loadIdentities(),
        useKeyStore.getState().loadKeys(),
        usePortForwardingStore.getState().loadRules(),
      ]);
    }
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isObjectSynced(id, "folder")) scheduleSync(); });
    if (prev) reportAuditMutation("folder", "deleted", { id: prev.id, name: prev.name, vault_id: prev.vault_id }, { object_type: prev.object_type });
  },

  moveObjectsToFolder: async (objectIds, objectType, folderId) => {
    const prevFolderIds = new Map<string, string | null>();
    // Partition objects into personal (local DB) vs team-vault (server-backed)
    const personalIds: string[] = [];
    const teamIdsByTeam = new Map<string, string[]>();

    const partition = <T extends { id: string; folder_id?: string | null }>(
      personal: T[],
      teamMap: Record<string, T[]>,
    ) => {
      for (const oid of objectIds) {
        const local = personal.find((x) => x.id === oid);
        if (local) {
          personalIds.push(oid);
          prevFolderIds.set(oid, local.folder_id ?? null);
          continue;
        }
        let found = false;
        for (const [tid, items] of Object.entries(teamMap)) {
          const item = items.find((x) => x.id === oid);
          if (item) {
            prevFolderIds.set(oid, item.folder_id ?? null);
            const arr = teamIdsByTeam.get(tid) ?? [];
            arr.push(oid);
            teamIdsByTeam.set(tid, arr);
            found = true;
            break;
          }
        }
        if (!found) prevFolderIds.set(oid, null);
      }
    };

    if (objectType === "connection") {
      const cs = useConnectionStore.getState();
      partition(cs.connections, cs.teamConnections);
    } else if (objectType === "key") {
      const ks = useKeyStore.getState();
      partition(ks.keys, ks.teamKeys);
    } else if (objectType === "identity") {
      const is = useIdentityStore.getState();
      partition(is.identities, is.teamIdentities);
    }

    if (personalIds.length > 0) {
      await api.moveObjectsToFolder(personalIds, objectType, folderId);
      isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isTypeSynced("folder")) scheduleSync(); });
    }

    for (const [teamId, ids] of teamIdsByTeam) {
      const now = new Date().toISOString();
      if (objectType === "connection") {
        const items = useConnectionStore.getState().teamConnections[teamId] ?? [];
        const updated = items.map((c) =>
          ids.includes(c.id)
            ? { ...c, folder_id: folderId ?? undefined, updated_at: now, clocks: { ...c.clocks, updated_at: now } }
            : c,
        );
        for (const c of updated) {
          if (ids.includes(c.id)) await saveTeamVaultObject(teamId, "connection", c);
        }
        useConnectionStore.setState((s) => ({
          teamConnections: { ...s.teamConnections, [teamId]: updated },
        }));
      } else if (objectType === "key") {
        const items = useKeyStore.getState().teamKeys[teamId] ?? [];
        const updated = items.map((k) =>
          ids.includes(k.id)
            ? { ...k, folder_id: folderId ?? undefined, updated_at: now, clocks: { ...k.clocks, updated_at: now } }
            : k,
        );
        for (const k of updated) {
          if (ids.includes(k.id)) await saveTeamVaultObject(teamId, "key", k);
        }
        useKeyStore.setState((s) => ({
          teamKeys: { ...s.teamKeys, [teamId]: updated },
        }));
      } else if (objectType === "identity") {
        const items = useIdentityStore.getState().teamIdentities[teamId] ?? [];
        const updated = items.map((i) =>
          ids.includes(i.id)
            ? { ...i, folder_id: folderId ?? undefined, updated_at: now, clocks: { ...i.clocks, updated_at: now } }
            : i,
        );
        for (const i of updated) {
          if (ids.includes(i.id)) await saveTeamVaultObject(teamId, "identity", i);
        }
        useIdentityStore.setState((s) => ({
          teamIdentities: { ...s.teamIdentities, [teamId]: updated },
        }));
      }
    }

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
      set((s) => ({ teamFolders: upsertInTeamMap(s.teamFolders, teamId, updated) }));
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
    await api.updateFolder(id, withPin<FolderFormData>({
      name: folder.name,
      object_type: folder.object_type,
      parent_folder_id: parentFolderId ?? undefined,
      vault_id: folder.vault_id,
    }, folder));
    const folders = await api.listFolders();
    set({ folders });
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isObjectSynced(id, "folder")) scheduleSync(); });
    useHistoryStore.getState().push({
      label: `Moved folder "${folder.name}"`,
      undo: async () => { await useFolderStore.getState().moveFolder(id, prevParentId); },
      redo: async () => { await useFolderStore.getState().moveFolder(id, parentFolderId); },
    });
  },

  pinFolder: async (id, pinned) => {
    const teamEntry = findTeamEntry(get().teamFolders, id);
    if (teamEntry) {
      await useTeamObjectPrefsStore.getState().setPinned(teamEntry.teamId, id, pinned);
      return;
    }

    const folder = get().folders.find((f) => f.id === id);
    if (!folder) return;
    const nextPinned = pinned ?? false;
    await api.updateFolder(id, {
      name: folder.name,
      object_type: folder.object_type,
      parent_folder_id: folder.parent_folder_id,
      vault_id: folder.vault_id,
      pinned: nextPinned,
    });
    set((s) => ({ folders: s.folders.map((f) => f.id === id ? { ...f, pinned: nextPinned } : f) }));
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isObjectSynced(id, "folder")) scheduleSync(); });
  },

  pinFolderForTeam: async (id, pinned) => {
    const teamEntry = findTeamEntry(get().teamFolders, id);
    if (!teamEntry) return;
    const { teamId, item: prev } = teamEntry;
    const now = new Date().toISOString();
    const updated: Folder = { ...prev, pinned, updated_at: now, clocks: { ...prev.clocks, updated_at: now } };
    await saveTeamVaultObject(teamId, "folder", updated);
    set((s) => ({ teamFolders: upsertInTeamMap(s.teamFolders, teamId, updated) }));
  },
}));
