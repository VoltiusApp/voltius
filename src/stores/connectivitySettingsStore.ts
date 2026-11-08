import { create } from "zustand";
import { persist } from "zustand/middleware";
import { writeAndTouch, writeAndTouchUnlessLocked } from "./appSettingsTimestampStore";
import { getToggle, hostToggle } from "./toggleSettingsStore";
import { inPolicyRange, isEnforcedLock, policyRange } from "./policyStore";
import { storeSetting } from "@/services/policy/effectiveCore";
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

function touchedSetter<K extends Setting>(set: (partial: Pick<ConnectivitySettings, K>) => void, field: K): Setter<K> {
  return (value) => {
    const write = () => set({ [field]: value } as Pick<ConnectivitySettings, K>);
    // The proxy stays writable under a lock so the user can fill in the username the lock leaves open.
    if (field === "proxy") writeAndTouch(policyKey(field), write);
    else writeAndTouchUnlessLocked(policyKey(field), write);
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

const keepaliveSetting = storeSetting(useConnectivitySettingsStore, "keepalivePreset", policyKey("keepalivePreset"));
const detachedTtlSetting = storeSetting(useConnectivitySettingsStore, "detachedTtlHours", policyKey("detachedTtlHours"));
const proxySetting = storeSetting(useConnectivitySettingsStore, "proxy", policyKey("proxy"));

/** Global default keepalive preset, used when a host has none of its own. */
export const getGlobalKeepalivePreset = keepaliveSetting.get;

export function resolveHostKeepalive(perHost: KeepalivePreset | undefined): KeepalivePreset {
  const key = policyKey("keepalivePreset");
  const global = getGlobalKeepalivePreset();
  if (perHost === undefined || isEnforcedLock(key)) return global;
  return inPolicyRange(policyRange(key), perHost) ? perHost : global;
}

export const useGlobalKeepalivePreset = (): [KeepalivePreset, (p: KeepalivePreset) => void] => [
  keepaliveSetting.use(),
  useConnectivitySettingsStore((s) => s.setKeepalivePreset),
];

export const getGlobalDetachedTtlHours = detachedTtlSetting.get;

export function resolveDetachedTtlSecs(): number | null {
  return getToggle("detached-session-ttl") ? getGlobalDetachedTtlHours() * 3600 : null;
}

export const useDetachedTtlHours = (): [DetachedTtlHours, (h: DetachedTtlHours) => void] => [
  detachedTtlSetting.use(),
  useConnectivitySettingsStore((s) => s.setDetachedTtlHours),
];

export function resolvePersistSession(perHost: boolean | undefined): boolean {
  return hostToggle("persistent-sessions", perHost);
}

export const getGlobalProxy = proxySetting.get;

export const useGlobalProxy = (): [GlobalProxy, (p: GlobalProxy) => void] => [
  proxySetting.use(),
  useConnectivitySettingsStore((s) => s.setProxy),
];
