import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { touchAppSetting } from "./appSettingsTimestampStore";
import { getToggle } from "./toggleSettingsStore";
import { DEFAULT_KEEPALIVE_PRESET, type KeepalivePreset } from "@/utils/keepalive";
import type { ProxyMode } from "@/types";
import { CONNECTIVITY_SETTINGS_VERSION, migrateConnectivitySettings } from "./connectivitySettingsMigration";

export type GlobalProxyMode = "none" | "system" | "socks5" | "http";

export interface GlobalProxy {
  mode: GlobalProxyMode;
  host?: string;
  port?: number;
  username?: string;
}

export const GLOBAL_PROXY_MODES: GlobalProxyMode[] = ["none", "system", "socks5", "http"];
export const HOST_PROXY_MODES: ProxyMode[] = ["direct", "system", "socks5", "http"];
export const DEFAULT_GLOBAL_PROXY: GlobalProxy = { mode: "none" };

interface ConnectivitySettingsState {
  keepalivePreset: KeepalivePreset;
  setKeepalivePreset: (preset: KeepalivePreset) => void;
  proxy: GlobalProxy;
  setProxy: (proxy: GlobalProxy) => void;
}

export const useConnectivitySettingsStore = create<ConnectivitySettingsState>()(
  persist(
    (set) => ({
      keepalivePreset: DEFAULT_KEEPALIVE_PRESET,
      setKeepalivePreset: (preset) => {
        set({ keepalivePreset: preset });
        touchAppSetting("appSettings.keepalivePreset");
      },
      proxy: DEFAULT_GLOBAL_PROXY,
      setProxy: (proxy) => {
        set({ proxy });
        touchAppSetting("appSettings.proxy");
      },
    }),
    {
      name: "voltius-connectivity-settings",
      version: CONNECTIVITY_SETTINGS_VERSION,
      migrate: (persisted, version) => {
        const { state, changed } = migrateConnectivitySettings(persisted, version);
        if (changed) queueMicrotask(() => touchAppSetting("appSettings.keepalivePreset"));
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

/** Per-host value wins; otherwise the global `persistent-sessions` toggle. */
export function resolvePersistSession(perHost: boolean | undefined): boolean {
  return perHost ?? getToggle("persistent-sessions");
}

export function getGlobalProxy(): GlobalProxy {
  return useConnectivitySettingsStore.getState().proxy;
}

export function useGlobalProxy(): [GlobalProxy, (p: GlobalProxy) => void] {
  return [useConnectivitySettingsStore((s) => s.proxy), useConnectivitySettingsStore((s) => s.setProxy)];
}
