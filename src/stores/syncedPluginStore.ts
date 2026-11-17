import { create } from "zustand";
import { invoke } from "@/lib/invoke";
import { isAlive, stamped, tombstoned, type TimestampedEntity } from "@/services/crdt";
import { getDeviceId } from "@/services/sync";
import { syncAfterEdit } from "@/stores/syncAfterEdit";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";

export interface SyncedPluginFields {
  repo: string;
  source_id: string;
  hash: string | null;
  css_hash: string | null;
  permissions: string[];
  name: string;
}

export interface SyncedPlugin extends TimestampedEntity, SyncedPluginFields {
  device_id: string;
  installed_at: string;
}

interface SyncedPluginStore {
  entries: SyncedPlugin[];
  load: () => Promise<void>;
  recordInstall: (id: string, fields: SyncedPluginFields) => Promise<void>;
  recordUninstall: (id: string) => Promise<void>;
  seed: (items: Array<{ id: string } & SyncedPluginFields>) => Promise<void>;
  live: (id: string) => SyncedPlugin | undefined;
}

const FILE = "synced_plugins";

export const useSyncedPluginStore = create<SyncedPluginStore>((set, get) => {
  const put = async (entry: SyncedPlugin) => {
    set({ entries: [...get().entries.filter((e) => e.id !== entry.id), entry] });
    try {
      await invoke("raw_entity_put", { file: FILE, entry });
      syncAfterEdit("plugin", entry.id);
    } catch (e) {
      await get().load();
      throw e;
    }
  };

  return {
    entries: [],

    load: async () => {
      set({ entries: await invoke<SyncedPlugin[]>("raw_entity_list", { file: FILE }) });
    },

    live: (id) => {
      const entry = get().entries.find((e) => e.id === id);
      return entry && isAlive(entry) ? entry : undefined;
    },

    recordInstall: async (id, fields) => {
      if (get().live(id)) return;
      const now = new Date().toISOString();
      const device_id = await getDeviceId();
      const fresh = stamped({ ...fields, device_id, installed_at: now }, now);
      const prior = get().entries.find((e) => e.id === id);
      await put({ ...prior, id, ...fresh, clocks: { ...prior?.clocks, ...fresh.clocks } });
    },

    recordUninstall: async (id) => {
      const entry = get().live(id);
      if (!entry || useSyncPrefsStore.getState().isExcluded(id)) return;
      const now = new Date().toISOString();
      const device_id = await getDeviceId();
      const dead = tombstoned(entry, now);
      await put({ ...dead, device_id, clocks: { ...dead.clocks, device_id: now } });
    },

    seed: async (items) => {
      for (const { id, ...fields } of items) {
        if (get().entries.some((e) => e.id === id)) continue;
        const device_id = await getDeviceId();
        await put({ id, ...fields, device_id, installed_at: "", clocks: {}, updated_at: "" });
      }
    },
  };
});
