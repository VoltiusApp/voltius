import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

type Overrides = Record<string, boolean>;

interface PluginRegistryStore {
  overrides: Overrides;
  /** Charge les overrides depuis plugin-registry.json (à appeler au démarrage). */
  load(): Promise<void>;
  /** Active ou désactive un plugin et persiste dans plugin-registry.json. */
  setEnabled(id: string, enabled: boolean): Promise<void>;
  /** Retourne l'état enabled, en appliquant l'override ou le defaultEnabled du manifest. */
  isEnabled(id: string, defaultEnabled: boolean): boolean;
}

export const usePluginRegistryStore = create<PluginRegistryStore>((set, get) => ({
  overrides: {},

  load: async () => {
    try {
      const overrides = await invoke<Overrides>("plugin_registry_load");
      set({ overrides });
    } catch {
      // Fichier absent ou erreur → on continue avec les defaultEnabled des manifests
    }
  },

  setEnabled: async (id, enabled) => {
    const overrides = { ...get().overrides, [id]: enabled };
    set({ overrides });
    await invoke("plugin_registry_save", { overrides }).catch(() => {});
  },

  isEnabled: (id, defaultEnabled) => get().overrides[id] ?? defaultEnabled,
}));
