import { create } from "zustand";
import { persist } from "zustand/middleware";
import { touchAppSetting } from "./appSettingsTimestampStore";
import { getToggle, hostToggle } from "./toggleSettingsStore";
import { inPolicyRange, isEnforcedLock, policyRange, writeUnlessLocked } from "./policyStore";
import { effectiveSettingWith, useEffectiveSettingWith } from "@/services/policy/effectiveCore";
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

const policyKey = (field: Setting) => `appSettings.${field}`;

// The proxy stays writable under a lock so the user can fill in the username the lock leaves open.
const WRITABLE_UNDER_LOCK: Setting[] = ["proxy"];

function touchedSetter<K extends Setting>(set: (partial: Pick<ConnectivitySettings, K>) => void, field: K): Setter<K> {
  const guard = WRITABLE_UNDER_LOCK.includes(field) ? (_key: string, write: () => void) => write() : writeUnlessLocked;
  return (value) =>
    guard(policyKey(field), () => {
      set({ [field]: value } as Pick<ConnectivitySettings, K>);
      touchAppSetting(policyKey(field));
    });
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

const builtInOf = (field: Setting) => useConnectivitySettingsStore.getInitialState()[field];

const effective = <K extends Setting>(field: K, stored: ConnectivitySettings[K]): ConnectivitySettings[K] =>
  effectiveSettingWith(policyKey(field), stored, builtInOf(field));

/** Global default keepalive preset, used when a host has none of its own. */
export function getGlobalKeepalivePreset(): KeepalivePreset {
  return effective("keepalivePreset", useConnectivitySettingsStore.getState().keepalivePreset);
}

export function resolveHostKeepalive(perHost: KeepalivePreset | undefined): KeepalivePreset {
  const key = policyKey("keepalivePreset");
  if (isEnforcedLock(key)) return getGlobalKeepalivePreset();
  const range = policyRange(key);
  if (range) return perHost !== undefined && inPolicyRange(range, perHost) ? perHost : getGlobalKeepalivePreset();
  return perHost ?? getGlobalKeepalivePreset();
}

function useConnectivitySetting<K extends Setting>(
  field: K,
  setter: (s: ConnectivitySettingsState) => Setter<K>,
): [ConnectivitySettings[K], Setter<K>] {
  const stored = useConnectivitySettingsStore((s) => s[field]);
  return [useEffectiveSettingWith(policyKey(field), stored, builtInOf(field)), useConnectivitySettingsStore(setter)];
}

export function useGlobalKeepalivePreset(): [KeepalivePreset, (p: KeepalivePreset) => void] {
  return useConnectivitySetting("keepalivePreset", (s) => s.setKeepalivePreset);
}

export function resolveDetachedTtlSecs(): number | null {
  return getToggle("detached-session-ttl")
    ? effective("detachedTtlHours", useConnectivitySettingsStore.getState().detachedTtlHours) * 3600
    : null;
}

export function useDetachedTtlHours(): [DetachedTtlHours, (h: DetachedTtlHours) => void] {
  return useConnectivitySetting("detachedTtlHours", (s) => s.setDetachedTtlHours);
}

export function resolvePersistSession(perHost: boolean | undefined): boolean {
  return hostToggle("persistent-sessions", perHost);
}

export function getGlobalProxy(): GlobalProxy {
  return effective("proxy", useConnectivitySettingsStore.getState().proxy);
}

export function useGlobalProxy(): [GlobalProxy, (p: GlobalProxy) => void] {
  return useConnectivitySetting("proxy", (s) => s.setProxy);
}
