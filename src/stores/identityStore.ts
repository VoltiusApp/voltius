import { create } from "zustand";
import type { Identity, IdentityFormData } from "@/types";
import * as api from "@/services/identities";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useHistoryStore } from "@/stores/historyStore";

interface IdentityStore {
  identities: Identity[];
  loadIdentities: () => Promise<void>;
  saveIdentity: (data: IdentityFormData) => Promise<Identity>;
  updateIdentity: (id: string, data: IdentityFormData) => Promise<void>;
  deleteIdentity: (id: string) => Promise<void>;
  pinIdentity: (id: string, pinned: boolean) => Promise<void>;
}

export const useIdentityStore = create<IdentityStore>((set) => ({
  identities: [],

  loadIdentities: async () => {
    const identities = await api.listIdentities();
    set({ identities });
  },

  saveIdentity: async (data) => {
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
    const prev = useIdentityStore.getState().identities.find((i) => i.id === id);
    await api.updateIdentity(id, data);
    const identities = await api.listIdentities();
    set({ identities });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "identity")) scheduleSync(); });
    if (prev) {
      const prevData: IdentityFormData = {
        name: prev.name,
        username: prev.username,
        key_id: prev.key_id,
        folder_id: prev.folder_id,
        vault_id: prev.vault_id,
      };
      useHistoryStore.getState().push({
        label: `Updated identity "${prev.name ?? prev.username}"`,
        undo: async () => { await useIdentityStore.getState().updateIdentity(id, prevData); },
        redo: async () => { await useIdentityStore.getState().updateIdentity(id, data); },
      });
    }
  },

  pinIdentity: async (id, pinned) => {
    const identity = useIdentityStore.getState().identities.find((i) => i.id === id);
    if (!identity) return;
    await api.updateIdentity(id, { name: identity.name, username: identity.username, key_id: identity.key_id, folder_id: identity.folder_id, vault_id: identity.vault_id, pinned });
    const identities = await api.listIdentities();
    set({ identities });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "identity")) scheduleSync(); });
  },

  deleteIdentity: async (id) => {
    const prev = useIdentityStore.getState().identities.find((i) => i.id === id);
    await api.deleteIdentity(id);
    const identities = await api.listIdentities();
    set({ identities });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "identity")) scheduleSync(); });
    if (prev) {
      const prevData: IdentityFormData = {
        name: prev.name,
        username: prev.username,
        key_id: prev.key_id,
        folder_id: prev.folder_id,
        vault_id: prev.vault_id,
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
