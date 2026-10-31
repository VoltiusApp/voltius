import { create } from "zustand";
import { persist } from "zustand/middleware";
import { touchAppSetting } from "./appSettingsTimestampStore";
import { getToggle } from "./toggleSettingsStore";
import { DEFAULT_KEEPALIVE_PRESET, type KeepalivePreset } from "@/utils/keepalive";
import type { CustomProxyMode, ProxyMode } from "@/types";
import { CONNECTIVITY_SETTINGS_VERSION, migrateConnectivitySettings } from "./connectivitySettingsMigration";

export const DETACHED_TTL_HOURS = [1, 6, 12, 24, 72, 168] as const;
export type DetachedTtlHours = (typeof DETACHED_TTL_HOURS)[number];
export const DEFAULT_DETACHED_TTL_HOURS: DetachedTtlHours = 24;

export type GlobalProxyMode = "none" | "system" | CustomProxyMode;

export interface GlobalProxy {
  mode: GlobalProxyMode;
  host?: string;
  port?: number;
  username?: string;
}

const CUSTOM_PROXY_MODES: CustomProxyMode[] = ["socks5", "http", "https"];
export const GLOBAL_PROXY_MODES: GlobalProxyMode[] = ["none", "system", ...CUSTOM_PROXY_MODES];
export const HOST_PROXY_MODES: ProxyMode[] = ["direct", "system", ...CUSTOM_PROXY_MODES];
export const DEFAULT_GLOBAL_PROXY: GlobalProxy = { mode: "none" };

interface ConnectivitySettings {
  keepalivePreset: KeepalivePreset;
  detachedTtlHours: DetachedTtlHours;
  proxy: GlobalProxy;
}

type Setting = keyof ConnectivitySettings;
type Setter<K extends Setting> = (value: ConnectivitySettings[K]) => void;

interface ConnectivitySettingsState extends ConnectivitySettings {
  setKeepalivePreset: Setter<"keepalivePreset">;
  setDetachedTtlHours: Setter<"detachedTtlHours">;
  setProxy: Setter<"proxy">;
}

function touchedSetter<K extends Setting>(set: (partial: Pick<ConnectivitySettings, K>) => void, field: K): Setter<K> {
  return (value) => {
    set({ [field]: value } as Pick<ConnectivitySettings, K>);
    touchAppSetting(`appSettings.${field}`);
  };
}

export const useConnectivitySettingsStore = create<ConnectivitySettingsState>()(
  persist(
    (set) => ({
      keepalivePreset: DEFAULT_KEEPALIVE_PRESET,
      setKeepalivePreset: touchedSetter(set, "keepalivePreset"),
      detachedTtlHours: DEFAULT_DETACHED_TTL_HOURS,
      setDetachedTtlHours: touchedSetter(set, "detachedTtlHours"),
      proxy: DEFAULT_GLOBAL_PROXY,
      setProxy: touchedSetter(set, "proxy"),
    }),
    {
      name: "voltius-connectivity-settings",
      version: CONNECTIVITY_SETTINGS_VERSION,
      migrate: (persisted, version) => migrateConnectivitySettings(persisted, version) as ConnectivitySettingsState,
    },
  ),
);

/** Global default keepalive preset, used when a host has none of its own. */
export function getGlobalKeepalivePreset(): KeepalivePreset {
  return useConnectivitySettingsStore.getState().keepalivePreset;
}

function useConnectivitySetting<K extends Setting>(
  field: K,
  setter: (s: ConnectivitySettingsState) => Setter<K>,
): [ConnectivitySettings[K], Setter<K>] {
  return [useConnectivitySettingsStore((s) => s[field]), useConnectivitySettingsStore(setter)];
}

export function useGlobalKeepalivePreset(): [KeepalivePreset, (p: KeepalivePreset) => void] {
  return useConnectivitySetting("keepalivePreset", (s) => s.setKeepalivePreset);
}

export function resolveDetachedTtlSecs(): number | null {
  return getToggle("detached-session-ttl")
    ? useConnectivitySettingsStore.getState().detachedTtlHours * 3600
    : null;
}

export function useDetachedTtlHours(): [DetachedTtlHours, (h: DetachedTtlHours) => void] {
  return useConnectivitySetting("detachedTtlHours", (s) => s.setDetachedTtlHours);
}

/** Per-host value wins; otherwise the global `persistent-sessions` toggle. */
export function resolvePersistSession(perHost: boolean | undefined): boolean {
  return perHost ?? getToggle("persistent-sessions");
}

export function getGlobalProxy(): GlobalProxy {
  return useConnectivitySettingsStore.getState().proxy;
}

export function useGlobalProxy(): [GlobalProxy, (p: GlobalProxy) => void] {
  return useConnectivitySetting("proxy", (s) => s.setProxy);
}
