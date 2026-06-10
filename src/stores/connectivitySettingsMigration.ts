import type { KeepalivePreset } from "@/utils/keepalive";

export const CONNECTIVITY_SETTINGS_VERSION = 1;

interface PersistedConnectivitySettings {
  keepalivePreset?: KeepalivePreset;
}

export function migrateConnectivitySettings(
  persisted: unknown,
  version: number,
): { state: PersistedConnectivitySettings; changed: boolean } {
  const state = (persisted ?? {}) as PersistedConnectivitySettings;
  if (version < 1 && state.keepalivePreset === "fast") {
    return { state: { ...state, keepalivePreset: "balanced" }, changed: true };
  }
  return { state, changed: false };
}
