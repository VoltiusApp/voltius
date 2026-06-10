import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";
import { DEFAULT_KEEPALIVE_PRESET, type KeepalivePreset } from "@/utils/keepalive";
import { CONNECTIVITY_SETTINGS_VERSION, migrateConnectivitySettings } from "./connectivitySettingsMigration";

interface ConnectivitySettingsState {
  keepalivePreset: KeepalivePreset;
  setKeepalivePreset: (preset: KeepalivePreset) => void;
}

export const useConnectivitySettingsStore = create<ConnectivitySettingsState>()(
  persist(
    (set) => ({
      keepalivePreset: DEFAULT_KEEPALIVE_PRESET,
      setKeepalivePreset: (preset) => {
        set({ keepalivePreset: preset });
        useAppSettingsTimestampStore.getState().touch();
      },
    }),
    {
      name: "voltius-connectivity-settings",
      version: CONNECTIVITY_SETTINGS_VERSION,
      migrate: (persisted, version) => {
        const { state, changed } = migrateConnectivitySettings(persisted, version);
        if (changed) queueMicrotask(() => useAppSettingsTimestampStore.getState().touch());
        return state as ConnectivitySettingsState;
      },
    },
  ),
);

/** Global default keepalive preset, used when a host has none of its own. */
export function getGlobalKeepalivePreset(): KeepalivePreset {
  return useConnectivitySettingsStore.getState().keepalivePreset;
}

export function useGlobalKeepalivePreset(): [KeepalivePreset, (p: KeepalivePreset) => void] {
  const value = useConnectivitySettingsStore((s) => s.keepalivePreset);
  const set = useConnectivitySettingsStore((s) => s.setKeepalivePreset);
  const setter = useCallback((p: KeepalivePreset) => set(p), [set]);
  return [value, setter];
}
