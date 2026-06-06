import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";
import { DEFAULT_KEEPALIVE_PRESET, type KeepalivePreset } from "@/utils/keepalive";

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
    { name: "voltius-connectivity-settings" },
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
