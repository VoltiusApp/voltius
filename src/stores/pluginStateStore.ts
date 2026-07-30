import { create } from "zustand";

/** Host-side landing zone for plugin-published state (`api.ui.publishState`).
 *  Keyed by `${pluginId}::${key}` so host UI can subscribe without importing
 *  plugin modules directly. Unloading/disabling a plugin clears its keys. */
interface PluginStateStore {
  values: Map<string, unknown>;
  publish(pluginId: string, key: string, value: unknown): void;
  read<T>(pluginId: string, key: string): T | undefined;
  clearPlugin(pluginId: string): void;
}

const storeKey = (pluginId: string, key: string) => `${pluginId}::${key}`;

export const usePluginStateStore = create<PluginStateStore>((set, get) => ({
  values: new Map(),

  publish(pluginId, key, value) {
    set((s) => {
      const next = new Map(s.values);
      next.set(storeKey(pluginId, key), value);
      return { values: next };
    });
  },

  read<T>(pluginId: string, key: string) {
    return get().values.get(storeKey(pluginId, key)) as T | undefined;
  },

  clearPlugin(pluginId) {
    const prefix = `${pluginId}::`;
    set((s) => {
      let changed = false;
      const next = new Map(s.values);
      for (const k of next.keys()) {
        if (k.startsWith(prefix)) {
          next.delete(k);
          changed = true;
        }
      }
      return changed ? { values: next } : {};
    });
  },
}));
