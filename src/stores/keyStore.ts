import { create } from "zustand";
import type { SshKey, SshKeyFormData } from "@/types";
import * as api from "@/services/keys";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useHistoryStore } from "@/stores/historyStore";
import { pushCreateHistory, pushDeleteHistory } from "@/stores/recreateHistory";
import { isTeamVaultId, findTeamEntry, setTeamMapEntry, clearTeamMapEntry, upsertInTeamMap, removeFromTeamMap, applyVaultTransition, saveStampedTeamObject } from "@/stores/teamVaultMap";
import { reportAuditMutation } from "@/services/auditMutations";
import { removeTeamVaultObject, saveTeamVaultObject } from "@/services/teamObjectPersistence";
import { useTeamObjectPrefsStore } from "@/stores/teamObjectPrefsStore";
import { classifyVaultTransition, migrateVaultObject } from "@/services/teamVaultMigration";
import { withPin } from "@/stores/withPin";

interface KeyStore {
  keys: SshKey[];
  teamKeys: Record<string, SshKey[]>;
  loadKeys: () => Promise<void>;
  setTeamKeys: (teamId: string, items: SshKey[]) => void;
  clearTeamKeys: (teamId?: string) => void;
  saveKey: (data: SshKeyFormData) => Promise<SshKey>;
  updateKey: (id: string, data: SshKeyFormData) => Promise<SshKey>;
  deleteKey: (id: string) => Promise<void>;
  pinKey: (id: string, pinned: boolean | null) => Promise<void>;
  pinKeyForTeam: (id: string, pinned: boolean) => Promise<void>;
}

export const useKeyStore = create<KeyStore>((set, get) => ({
  keys: [],
  teamKeys: {},

  loadKeys: async () => {
    const keys = await api.listKeys();
    set({ keys });
  },

  setTeamKeys: (teamId, items) =>
    set((s) => ({ teamKeys: setTeamMapEntry(s.teamKeys, teamId, items) })),

  clearTeamKeys: (teamId) =>
    set((s) => ({ teamKeys: clearTeamMapEntry(s.teamKeys, teamId) })),

  saveKey: async (data) => {
    if (isTeamVaultId(data.vault_id)) {
      const now = new Date().toISOString();
      const key: SshKey = {
        id: crypto.randomUUID(),
        name: data.name,
        key_type: data.key_type,
        tags: data.tags,
        folder_id: data.folder_id,
        vault_id: data.vault_id,
        pinned: data.pinned,
        created_at: now,
        updated_at: now,
        clocks: { created_at: now, updated_at: now },
      };
      const vaultId = data.vault_id!;
      await saveTeamVaultObject(vaultId, "key", key);
      set((s) => ({ teamKeys: upsertInTeamMap(s.teamKeys, vaultId, key) }));
      reportAuditMutation("key", "created", { id: key.id, name: key.name ?? "unnamed", vault_id: key.vault_id }, { key_type: key.key_type });
      pushCreateHistory({
        label: `Saved key "${key.name ?? "unnamed"}"`,
        id: key.id,
        data,
        create: (d) => useKeyStore.getState().saveKey(d),
        remove: (kid) => useKeyStore.getState().deleteKey(kid),
      });
      return key;
    }

    const key = await api.saveKey(data);
    const keys = await api.listKeys();
    set({ keys });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isTypeSynced("key")) scheduleSync(); });
    reportAuditMutation("key", "created", { id: key.id, name: key.name ?? "unnamed", vault_id: key.vault_id }, { key_type: key.key_type });
    pushCreateHistory({
      label: `Saved key "${key.name ?? "unnamed"}"`,
      id: key.id,
      data,
      create: (d) => useKeyStore.getState().saveKey(d),
      remove: (kid) => useKeyStore.getState().deleteKey(kid),
    });
    return key;
  },

  updateKey: async (id, data) => {
    const teamEntry = findTeamEntry(get().teamKeys, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      const payload = withPin(data, prev);
      const now = new Date().toISOString();
      const updated: SshKey = {
        ...prev,
        name: data.name,
        key_type: data.key_type,
        tags: data.tags,
        folder_id: data.folder_id,
        vault_id: data.vault_id ?? prev.vault_id,
        pinned: payload.pinned,
        updated_at: now,
        clocks: { ...prev.clocks, updated_at: now },
      };
      const migrated = await migrateVaultObject({
        previousVaultId: teamId,
        nextVaultId: updated.vault_id,
        isTeamVaultId,
        item: updated,
        updateLocal: () => api.updateKey(id, payload),
        adoptLocal: () => api.adoptKey(id, payload),
        saveTeam: (tid, item) => saveTeamVaultObject(tid, "key", item),
        removeTeam: removeTeamVaultObject,
      });
      const transition = classifyVaultTransition(teamId, migrated.vault_id, isTeamVaultId);
      const localKeys = transition.kind === "team-to-local" ? await api.listKeys() : undefined;
      set((s) => {
        const next = applyVaultTransition(s.teamKeys, transition, id, migrated, teamId);
        return localKeys ? { keys: localKeys, teamKeys: next } : { teamKeys: next };
      });
      reportAuditMutation("key", "updated", { id: migrated.id, name: migrated.name ?? "unnamed", vault_id: migrated.vault_id }, { key_type: migrated.key_type });
      const prevData: SshKeyFormData = {
        name: prev.name, key_type: prev.key_type,
        tags: prev.tags,
        folder_id: prev.folder_id, vault_id: prev.vault_id,
      };
      useHistoryStore.getState().push({
        label: `Updated key "${prev.name ?? "unnamed"}"`,
        undo: async () => { await useKeyStore.getState().updateKey(id, prevData); },
        redo: async () => { await useKeyStore.getState().updateKey(id, data); },
      });
      return migrated;
    }

    const prev = get().keys.find((k) => k.id === id);
    let key: SshKey;
    if (prev) {
      const nextVaultId = data.vault_id ?? prev.vault_id;
      const payload = withPin(data, prev);
      key = await migrateVaultObject({
        previousVaultId: prev.vault_id,
        nextVaultId,
        isTeamVaultId,
        item: { ...prev, ...payload, vault_id: nextVaultId },
        updateLocal: () => api.updateKey(id, payload),
        adoptLocal: () => api.adoptKey(id, payload),
        saveTeam: (teamId, item) => saveTeamVaultObject(teamId, "key", item),
        removeTeam: removeTeamVaultObject,
      });
    } else {
      key = await api.updateKey(id, data);
    }
    const keys = await api.listKeys();
    set((s) => ({
      keys,
      teamKeys: prev
        ? applyVaultTransition(s.teamKeys, classifyVaultTransition(prev.vault_id, key.vault_id, isTeamVaultId), id, key)
        : s.teamKeys,
    }));
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "key")) scheduleSync(); });
    if (prev) reportAuditMutation("key", "updated", { id, name: data.name ?? prev.name ?? "unnamed", vault_id: data.vault_id ?? prev.vault_id }, { key_type: data.key_type ?? prev.key_type });
    if (prev) {
      const prevData: SshKeyFormData = {
        name: prev.name, key_type: prev.key_type,
        tags: prev.tags,
        folder_id: prev.folder_id, vault_id: prev.vault_id,
      };
      useHistoryStore.getState().push({
        label: `Updated key "${prev.name ?? "unnamed"}"`,
        undo: async () => { await useKeyStore.getState().updateKey(id, prevData); },
        redo: async () => { await useKeyStore.getState().updateKey(id, data); },
      });
    }
    return key;
  },

  pinKey: async (id, pinned) => {
    const teamEntry = findTeamEntry(get().teamKeys, id);
    if (teamEntry) {
      await useTeamObjectPrefsStore.getState().setPinned(teamEntry.teamId, id, pinned);
      return;
    }

    const key = get().keys.find((k) => k.id === id);
    if (!key) return;
    const nextPinned = pinned ?? false;
    await api.updateKey(id, {
      name: key.name, key_type: key.key_type,
      tags: key.tags,
      folder_id: key.folder_id, vault_id: key.vault_id, pinned: nextPinned,
    });
    const keys = await api.listKeys();
    set({ keys });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "key")) scheduleSync(); });
  },

  pinKeyForTeam: async (id, pinned) => {
    const teamEntry = findTeamEntry(get().teamKeys, id);
    if (!teamEntry) return;
    const { teamId } = teamEntry;
    const updated = await saveStampedTeamObject(teamId, "key", teamEntry.item, { pinned });
    set((s) => ({ teamKeys: upsertInTeamMap(s.teamKeys, teamId, updated) }));
  },

  deleteKey: async (id) => {
    const teamEntry = findTeamEntry(get().teamKeys, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      await removeTeamVaultObject(teamId, id);
      set((s) => ({ teamKeys: removeFromTeamMap(s.teamKeys, teamId, id) }));
      reportAuditMutation("key", "deleted", { id: prev.id, name: prev.name ?? "unnamed", vault_id: prev.vault_id }, { key_type: prev.key_type });
      const prevData: SshKeyFormData = {
        name: prev.name, key_type: prev.key_type,
        tags: prev.tags,
        folder_id: prev.folder_id, vault_id: prev.vault_id,
      };
      pushDeleteHistory({
        label: `Deleted key "${prev.name ?? "unnamed"}"`,
        id,
        data: prevData,
        create: (d) => useKeyStore.getState().saveKey(d),
        remove: (kid) => useKeyStore.getState().deleteKey(kid),
      });
      return;
    }

    const prev = get().keys.find((k) => k.id === id);
    await api.deleteKey(id);
    const keys = await api.listKeys();
    set({ keys });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "key")) scheduleSync(); });
    if (prev) reportAuditMutation("key", "deleted", { id: prev.id, name: prev.name ?? "unnamed", vault_id: prev.vault_id }, { key_type: prev.key_type });
    if (prev) {
      const prevData: SshKeyFormData = {
        name: prev.name, key_type: prev.key_type,
        tags: prev.tags,
        folder_id: prev.folder_id, vault_id: prev.vault_id,
      };
      pushDeleteHistory({
        label: `Deleted key "${prev.name ?? "unnamed"}"`,
        id,
        data: prevData,
        create: (d) => useKeyStore.getState().saveKey(d),
        remove: (kid) => useKeyStore.getState().deleteKey(kid),
      });
    }
  },
}));
