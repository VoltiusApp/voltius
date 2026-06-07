import { create } from "zustand";
import { getAutoUpdate, setAutoUpdate as setAutoUpdateRust } from "@/services/updater";

/**
 * Reactive mirror of the Rust-owned auto-update preference (config_dir/updater.json).
 * Rust remains the source of truth for the background loop; this store keeps the UI
 * (Settings + OmniSearch toggle) live and writes through on change.
 */
interface UpdaterPrefState {
  autoUpdate: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setAutoUpdate: (enabled: boolean) => void;
}

export const useUpdaterPrefStore = create<UpdaterPrefState>((set) => ({
  autoUpdate: true,
  loaded: false,
  load: async () => {
    try {
      const enabled = await getAutoUpdate();
      set({ autoUpdate: enabled, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  setAutoUpdate: (enabled) => {
    set({ autoUpdate: enabled });
    setAutoUpdateRust(enabled).catch(() => {});
  },
}));
