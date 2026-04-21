import { create } from "zustand";
import type { SshKey, SshKeyFormData } from "@/types";
import * as api from "@/services/keys";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useHistoryStore } from "@/stores/historyStore";

interface KeyStore {
  keys: SshKey[];
  loadKeys: () => Promise<void>;
  saveKey: (data: SshKeyFormData) => Promise<SshKey>;
  updateKey: (id: string, data: SshKeyFormData) => Promise<SshKey>;
  deleteKey: (id: string) => Promise<void>;
  pinKey: (id: string, pinned: boolean) => Promise<void>;
}

export const useKeyStore = create<KeyStore>((set) => ({
  keys: [],

  loadKeys: async () => {
    const keys = await api.listKeys();
    set({ keys });
  },

  saveKey: async (data) => {
    const key = await api.saveKey(data);
    const keys = await api.listKeys();
    set({ keys });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isTypeSynced("key")) scheduleSync(); });
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
    const prev = useKeyStore.getState().keys.find((k) => k.id === id);
    const key = await api.updateKey(id, data);
    const keys = await api.listKeys();
    set({ keys });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "key")) scheduleSync(); });
    if (prev) {
      const prevData: SshKeyFormData = {
        name: prev.name,
        key_type: prev.key_type,
        folder_id: prev.folder_id,
        vault_id: prev.vault_id,
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
    const key = useKeyStore.getState().keys.find((k) => k.id === id);
    if (!key) return;
    await api.updateKey(id, { name: key.name, key_type: key.key_type, folder_id: key.folder_id, vault_id: key.vault_id, pinned });
    const keys = await api.listKeys();
    set({ keys });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "key")) scheduleSync(); });
  },

  deleteKey: async (id) => {
    const prev = useKeyStore.getState().keys.find((k) => k.id === id);
    await api.deleteKey(id);
    const keys = await api.listKeys();
    set({ keys });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "key")) scheduleSync(); });
    if (prev) {
      const prevData: SshKeyFormData = {
        name: prev.name,
        key_type: prev.key_type,
        folder_id: prev.folder_id,
        vault_id: prev.vault_id,
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
