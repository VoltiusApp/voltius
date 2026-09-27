import type { KeepalivePreset } from "@/utils/keepalive";

export const CONNECTIVITY_SETTINGS_VERSION = 1;

interface PersistedConnectivitySettings {
  keepalivePreset?: KeepalivePreset;
}

export function migrateConnectivitySettings(
  persisted: unknown,
  version: number,
): PersistedConnectivitySettings {
  const state = (persisted ?? {}) as PersistedConnectivitySettings;
  if (version < 1 && state.keepalivePreset === "fast") return { ...state, keepalivePreset: "balanced" };
  return state;
}
