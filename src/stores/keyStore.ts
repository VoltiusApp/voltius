import { create } from "zustand";
import type { SshKey, SshKeyFormData } from "@/types";
import * as api from "@/services/keys";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useTeamStore } from "@/stores/teamStore";
import { reportAuditMutation } from "@/services/auditMutations";
import { removeTeamVaultObject, saveTeamVaultObject } from "@/services/teamObjectPersistence";

function isTeamVaultId(vaultId: string | null | undefined): vaultId is string {
  if (!vaultId) return false;
  return useTeamStore.getState().teams.some((t) => t.id === vaultId);
}

function upsert(arr: SshKey[], item: SshKey): SshKey[] {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...arr, item];
  const next = [...arr];
  next[idx] = item;
  return next;
}

function findTeamEntry(
  teamMap: Record<string, SshKey[]>,
  id: string,
): { teamId: string; item: SshKey } | null {
  for (const [teamId, items] of Object.entries(teamMap)) {
    const item = items.find((x) => x.id === id);
    if (item) return { teamId, item };
  }
  return null;
}

interface KeyStore {
  keys: SshKey[];
  teamKeys: Record<string, SshKey[]>;
  loadKeys: () => Promise<void>;
  setTeamKeys: (teamId: string, items: SshKey[]) => void;
  clearTeamKeys: (teamId?: string) => void;
  saveKey: (data: SshKeyFormData) => Promise<SshKey>;
  updateKey: (id: string, data: SshKeyFormData) => Promise<SshKey>;
  deleteKey: (id: string) => Promise<void>;
  pinKey: (id: string, pinned: boolean) => Promise<void>;
}

export const useKeyStore = create<KeyStore>((set, get) => ({
  keys: [],
  teamKeys: {},

  loadKeys: async () => {
    const keys = await api.listKeys();
    set({ keys });
  },

  setTeamKeys: (teamId, items) =>
    set((s) => ({ teamKeys: { ...s.teamKeys, [teamId]: items } })),

  clearTeamKeys: (teamId) =>
    set((s) => {
      if (teamId === undefined) return { teamKeys: {} };
      const next = { ...s.teamKeys };
      delete next[teamId];
      return { teamKeys: next };
    }),

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
      set((s) => ({
        teamKeys: {
          ...s.teamKeys,
          [vaultId]: upsert(s.teamKeys[vaultId] ?? [], key),
        },
      }));
      reportAuditMutation("key", "created", { id: key.id, name: key.name ?? "unnamed", vault_id: key.vault_id }, { key_type: key.key_type });
      let recreatedId: string | null = null;
      useHistoryStore.getState().push({
        label: `Saved key "${key.name ?? "unnamed"}"`,
        undo: async () => {
          await useKeyStore.getState().deleteKey(recreatedId ?? key.id);
          recreatedId = null;
        },
        redo: async () => {
          const r = await useKeyStore.getState().saveKey(data);
          recreatedId = r.id;
        },
      });
      return key;
    }

    const key = await api.saveKey(data);
    const keys = await api.listKeys();
    set({ keys });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isTypeSynced("key")) scheduleSync(); });
    reportAuditMutation("key", "created", { id: key.id, name: key.name ?? "unnamed", vault_id: key.vault_id }, { key_type: key.key_type });
    let recreatedId: string | null = null;
    useHistoryStore.getState().push({
      label: `Saved key "${key.name ?? "unnamed"}"`,
      undo: async () => {
        await useKeyStore.getState().deleteKey(recreatedId ?? key.id);
        recreatedId = null;
      },
      redo: async () => {
        const r = await useKeyStore.getState().saveKey(data);
        recreatedId = r.id;
      },
    });
    return key;
  },

  updateKey: async (id, data) => {
    const teamEntry = findTeamEntry(get().teamKeys, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      const now = new Date().toISOString();
      const updated: SshKey = {
        ...prev,
        name: data.name,
        key_type: data.key_type,
        tags: data.tags,
        folder_id: data.folder_id,
        vault_id: data.vault_id ?? prev.vault_id,
        pinned: data.pinned,
        updated_at: now,
        clocks: { ...prev.clocks, updated_at: now },
      };
      await saveTeamVaultObject(teamId, "key", updated);
      set((s) => ({
        teamKeys: {
          ...s.teamKeys,
          [teamId]: upsert(s.teamKeys[teamId] ?? [], updated),
        },
      }));
      reportAuditMutation("key", "updated", { id: updated.id, name: updated.name ?? "unnamed", vault_id: updated.vault_id }, { key_type: updated.key_type });
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
      return updated;
    }

    const prev = get().keys.find((k) => k.id === id);
    const key = await api.updateKey(id, data);
    const keys = await api.listKeys();
    set({ keys });
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
      const { teamId, item: prev } = teamEntry;
      const now = new Date().toISOString();
      const updated: SshKey = { ...prev, pinned, updated_at: now, clocks: { ...prev.clocks, updated_at: now } };
      await saveTeamVaultObject(teamId, "key", updated);
      set((s) => ({
        teamKeys: {
          ...s.teamKeys,
          [teamId]: upsert(s.teamKeys[teamId] ?? [], updated),
        },
      }));
      return;
    }

    const key = get().keys.find((k) => k.id === id);
    if (!key) return;
    await api.updateKey(id, {
      name: key.name, key_type: key.key_type,
      tags: key.tags,
      folder_id: key.folder_id, vault_id: key.vault_id, pinned,
    });
    const keys = await api.listKeys();
    set({ keys });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "key")) scheduleSync(); });
  },

  deleteKey: async (id) => {
    const teamEntry = findTeamEntry(get().teamKeys, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      await removeTeamVaultObject(teamId, id);
      set((s) => ({
        teamKeys: {
          ...s.teamKeys,
          [teamId]: (s.teamKeys[teamId] ?? []).filter((x) => x.id !== id),
        },
      }));
      reportAuditMutation("key", "deleted", { id: prev.id, name: prev.name ?? "unnamed", vault_id: prev.vault_id }, { key_type: prev.key_type });
      const prevData: SshKeyFormData = {
        name: prev.name, key_type: prev.key_type,
        tags: prev.tags,
        folder_id: prev.folder_id, vault_id: prev.vault_id,
      };
      let recreatedId: string | null = null;
      useHistoryStore.getState().push({
        label: `Deleted key "${prev.name ?? "unnamed"}"`,
        undo: async () => {
          const r = await useKeyStore.getState().saveKey(prevData);
          recreatedId = r.id;
        },
        redo: async () => {
          await useKeyStore.getState().deleteKey(recreatedId ?? id);
          recreatedId = null;
        },
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
      let recreatedId: string | null = null;
      useHistoryStore.getState().push({
        label: `Deleted key "${prev.name ?? "unnamed"}"`,
        undo: async () => {
          const r = await useKeyStore.getState().saveKey(prevData);
          recreatedId = r.id;
        },
        redo: async () => {
          await useKeyStore.getState().deleteKey(recreatedId ?? id);
          recreatedId = null;
        },
      });
    }
  },
}));
