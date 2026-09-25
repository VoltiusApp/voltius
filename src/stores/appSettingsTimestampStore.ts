import { create } from "zustand";
import { persist } from "zustand/middleware";
import { pushSettingsChange, remoteApplyTimestamp, settingsStamp } from "./remoteApplyGuard";
import { useSyncPrefsStore } from "./syncPrefsStore";
import { settingKey } from "@/services/user-data/settingKeys";

interface AppSettingsTimestampStore {
  updatedAt: string;
  touch(): void;
}

export const useAppSettingsTimestampStore = create<AppSettingsTimestampStore>()(
  persist(
    (set) => ({
      updatedAt: new Date(0).toISOString(),
      touch: () => {
        set({ updatedAt: settingsStamp() });
        pushSettingsChange();
      },
    }),
    { name: "voltius-app-settings-ts" },
  ),
);

/**
 * Record a write to the appSettings leaf `id` (a SETTING_KEYS id, e.g.
 * "appSettings.locale"). The whole section shares one last-write-wins clock,
 * so a local edit may only move it for a leaf this device syncs: stamping for
 * a value the bundle doesn't carry (an SFTP column width) or holds back would
 * push this device's unchanged synced values under a newer stamp, reverting
 * another device's edit to them. A remote apply always adopts the section's
 * timestamp, held-back leaves included (see remoteApplyGuard).
 */
export function touchAppSetting(id: string): void {
  const synced = settingKey(id) !== undefined && useSyncPrefsStore.getState().isSettingSynced(id);
  if (synced || remoteApplyTimestamp() !== null) useAppSettingsTimestampStore.getState().touch();
}
