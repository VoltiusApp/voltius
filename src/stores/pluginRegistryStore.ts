import { create } from "zustand";
import { invoke } from "@/lib/invoke";
import { touchAppSetting } from "./appSettingsTimestampStore";
import { lockedList } from "./policyStore";

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

const listed = (key: string, id: string): boolean => !!lockedList(key)?.includes(id);

export function pluginLock(id: string): boolean | null {
  if (listed("plugins.disabled", id)) return false;
  return listed("plugins.enabled", id) ? true : null;
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
    if (pluginLock(id) !== null) return;
    const overrides = { ...get().overrides, [id]: enabled };
    set({ overrides });
    touchAppSetting("appSettings.plugins.overrides");
    await invoke("plugin_registry_save", { overrides }).catch(() => {});
  },

  isEnabled: (id, defaultEnabled) => pluginLock(id) ?? get().overrides[id] ?? defaultEnabled,
}));
