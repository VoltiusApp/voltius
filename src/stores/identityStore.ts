import { create } from "zustand";
import type { Identity, IdentityFormData } from "@/types";
import * as api from "@/services/identities";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useTeamStore } from "@/stores/teamStore";

function isTeamVaultId(vaultId: string | null | undefined): vaultId is string {
  if (!vaultId) return false;
  return useTeamStore.getState().teams.some((t) => t.id === vaultId);
}

function upsert(arr: Identity[], item: Identity): Identity[] {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...arr, item];
  const next = [...arr];
  next[idx] = item;
  return next;
}

function findTeamEntry(
  teamMap: Record<string, Identity[]>,
  id: string,
): { teamId: string; item: Identity } | null {
  for (const [teamId, items] of Object.entries(teamMap)) {
    const item = items.find((x) => x.id === id);
    if (item) return { teamId, item };
  }
  return null;
}

async function triggerTeamSave(teamId: string): Promise<void> {
  const { saveTeamData } = await import("@/services/teamVaultSync");
  saveTeamData(teamId).catch(() => {});
}

interface IdentityStore {
  identities: Identity[];
  teamIdentities: Record<string, Identity[]>;
  loadIdentities: () => Promise<void>;
  setTeamIdentities: (teamId: string, items: Identity[]) => void;
  clearTeamIdentities: (teamId?: string) => void;
  saveIdentity: (data: IdentityFormData) => Promise<Identity>;
  updateIdentity: (id: string, data: IdentityFormData) => Promise<void>;
  deleteIdentity: (id: string) => Promise<void>;
  pinIdentity: (id: string, pinned: boolean) => Promise<void>;
}

export const useIdentityStore = create<IdentityStore>((set, get) => ({
  identities: [],
  teamIdentities: {},

  loadIdentities: async () => {
    const identities = await api.listIdentities();
    set({ identities });
  },

  setTeamIdentities: (teamId, items) =>
    set((s) => ({ teamIdentities: { ...s.teamIdentities, [teamId]: items } })),

  clearTeamIdentities: (teamId) =>
    set((s) => {
      if (teamId === undefined) return { teamIdentities: {} };
      const next = { ...s.teamIdentities };
      delete next[teamId];
      return { teamIdentities: next };
    }),

  saveIdentity: async (data) => {
    if (isTeamVaultId(data.vault_id)) {
      const now = new Date().toISOString();
      const identity: Identity = {
        id: crypto.randomUUID(),
        name: data.name,
        username: data.username,
        key_id: data.key_id,
        tags: data.tags,
        folder_id: data.folder_id,
        vault_id: data.vault_id,
        pinned: data.pinned,
        created_at: now,
        updated_at: now,
        clocks: { created_at: now, updated_at: now },
      };
      const vaultId = data.vault_id!;
      set((s) => ({
        teamIdentities: {
          ...s.teamIdentities,
          [vaultId]: upsert(s.teamIdentities[vaultId] ?? [], identity),
        },
      }));
      void triggerTeamSave(vaultId);
      let recreatedId: string | null = null;
      useHistoryStore.getState().push({
        label: `Created identity "${identity.name ?? identity.username}"`,
        undo: async () => {
          await useIdentityStore.getState().deleteIdentity(recreatedId ?? identity.id);
          recreatedId = null;
        },
        redo: async () => {
          const r = await useIdentityStore.getState().saveIdentity(data);
          recreatedId = r.id;
        },
      });
      return identity;
    }

    const identity = await api.saveIdentity(data);
    const identities = await api.listIdentities();
    set({ identities });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isTypeSynced("identity")) scheduleSync(); });
    let recreatedId: string | null = null;
    useHistoryStore.getState().push({
      label: `Created identity "${identity.name ?? identity.username}"`,
      undo: async () => {
        await useIdentityStore.getState().deleteIdentity(recreatedId ?? identity.id);
        recreatedId = null;
      },
      redo: async () => {
        const r = await useIdentityStore.getState().saveIdentity(data);
        recreatedId = r.id;
      },
    });
    return identity;
  },

  updateIdentity: async (id, data) => {
    const teamEntry = findTeamEntry(get().teamIdentities, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      const now = new Date().toISOString();
      const updated: Identity = {
        ...prev,
        name: data.name,
        username: data.username,
        key_id: data.key_id,
        tags: data.tags,
        folder_id: data.folder_id,
        vault_id: data.vault_id ?? prev.vault_id,
        pinned: data.pinned,
        updated_at: now,
        clocks: { ...prev.clocks, updated_at: now },
      };
      set((s) => ({
        teamIdentities: {
          ...s.teamIdentities,
          [teamId]: upsert(s.teamIdentities[teamId] ?? [], updated),
        },
      }));
      void triggerTeamSave(teamId);
      const prevData: IdentityFormData = {
        name: prev.name, username: prev.username, key_id: prev.key_id,
        tags: prev.tags,
        folder_id: prev.folder_id, vault_id: prev.vault_id,
      };
      useHistoryStore.getState().push({
        label: `Updated identity "${prev.name ?? prev.username}"`,
        undo: async () => { await useIdentityStore.getState().updateIdentity(id, prevData); },
        redo: async () => { await useIdentityStore.getState().updateIdentity(id, data); },
      });
      return;
    }

    const prev = get().identities.find((i) => i.id === id);
    await api.updateIdentity(id, data);
    const identities = await api.listIdentities();
    set({ identities });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "identity")) scheduleSync(); });
    if (prev) {
      const prevData: IdentityFormData = {
        name: prev.name, username: prev.username, key_id: prev.key_id,
        tags: prev.tags,
        folder_id: prev.folder_id, vault_id: prev.vault_id,
      };
      useHistoryStore.getState().push({
        label: `Updated identity "${prev.name ?? prev.username}"`,
        undo: async () => { await useIdentityStore.getState().updateIdentity(id, prevData); },
        redo: async () => { await useIdentityStore.getState().updateIdentity(id, data); },
      });
    }
  },

  pinIdentity: async (id, pinned) => {
    const teamEntry = findTeamEntry(get().teamIdentities, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      const now = new Date().toISOString();
      const updated: Identity = { ...prev, pinned, updated_at: now, clocks: { ...prev.clocks, updated_at: now } };
      set((s) => ({
        teamIdentities: {
          ...s.teamIdentities,
          [teamId]: upsert(s.teamIdentities[teamId] ?? [], updated),
        },
      }));
      void triggerTeamSave(teamId);
      return;
    }

    const identity = get().identities.find((i) => i.id === id);
    if (!identity) return;
    await api.updateIdentity(id, {
      name: identity.name, username: identity.username, key_id: identity.key_id,
      tags: identity.tags,
      folder_id: identity.folder_id, vault_id: identity.vault_id, pinned,
    });
    const identities = await api.listIdentities();
    set({ identities });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "identity")) scheduleSync(); });
  },

  deleteIdentity: async (id) => {
    const teamEntry = findTeamEntry(get().teamIdentities, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      set((s) => ({
        teamIdentities: {
          ...s.teamIdentities,
          [teamId]: (s.teamIdentities[teamId] ?? []).filter((x) => x.id !== id),
        },
      }));
      void triggerTeamSave(teamId);
      const prevData: IdentityFormData = {
        name: prev.name, username: prev.username, key_id: prev.key_id,
        tags: prev.tags,
        folder_id: prev.folder_id, vault_id: prev.vault_id,
      };
      let recreatedId: string | null = null;
      useHistoryStore.getState().push({
        label: `Deleted identity "${prev.name ?? prev.username}"`,
        undo: async () => {
          const r = await useIdentityStore.getState().saveIdentity(prevData);
          recreatedId = r.id;
        },
        redo: async () => {
          await useIdentityStore.getState().deleteIdentity(recreatedId ?? id);
          recreatedId = null;
        },
      });
      return;
    }

    const prev = get().identities.find((i) => i.id === id);
    await api.deleteIdentity(id);
    const identities = await api.listIdentities();
    set({ identities });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "identity")) scheduleSync(); });
    if (prev) {
      const prevData: IdentityFormData = {
        name: prev.name, username: prev.username, key_id: prev.key_id,
        tags: prev.tags,
        folder_id: prev.folder_id, vault_id: prev.vault_id,
      };
      let recreatedId: string | null = null;
      useHistoryStore.getState().push({
        label: `Deleted identity "${prev.name ?? prev.username}"`,
        undo: async () => {
          const r = await useIdentityStore.getState().saveIdentity(prevData);
          recreatedId = r.id;
        },
        redo: async () => {
          await useIdentityStore.getState().deleteIdentity(recreatedId ?? id);
          recreatedId = null;
        },
      });
    }
  },
}));
