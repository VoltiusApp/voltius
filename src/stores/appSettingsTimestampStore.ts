import { create } from "zustand";
import { persist } from "zustand/middleware";
import { pushSettingsChange, remoteApplyTimestamp, settingsStamp } from "./remoteApplyGuard";
import { useSyncPrefsStore } from "./syncPrefsStore";
import { keysForDomain, relPath, settingKey } from "@/services/user-data/settingKeys";

const APP_SETTING_LEAVES = () => keysForDomain("appSettings").map((k) => relPath(k.id));

interface AppSettingsTimestampStore {
  // The section's clock, for peers that merge the section as a whole.
  updatedAt: string;
  // Per-leaf clocks keyed by path within the section, e.g. "terminal.cursorStyle".
  clocks: Record<string, string>;
  touch(leaves?: string[]): void;
  adoptClocks(clocks: Record<string, string>): void;
}

export const useAppSettingsTimestampStore = create<AppSettingsTimestampStore>()(
  persist(
    (set) => ({
      updatedAt: new Date(0).toISOString(),
      clocks: {},
      touch: (leaves = APP_SETTING_LEAVES()) => {
        const at = settingsStamp();
        // A remote apply sets leaf clocks once, from the merge, via adoptClocks.
        const remote = remoteApplyTimestamp() !== null;
        set((s) => ({
          updatedAt: at,
          clocks: remote ? s.clocks : { ...s.clocks, ...Object.fromEntries(leaves.map((l) => [l, at])) },
        }));
        pushSettingsChange();
      },
      adoptClocks: (clocks) => set((s) => {
        const merged = { ...s.clocks };
        for (const [leaf, at] of Object.entries(clocks)) {
          if (typeof at === "string" && at > (merged[leaf] ?? "")) merged[leaf] = at;
        }
        return { clocks: merged };
      }),
    }),
    {
      name: "voltius-app-settings-ts",
      version: 1,
      // Before per-leaf clocks every leaf carried the section's clock.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as { updatedAt?: string; clocks?: Record<string, string> };
        if (version < 1 && state.updatedAt) {
          state.clocks = Object.fromEntries(APP_SETTING_LEAVES().map((l) => [l, state.updatedAt!]));
        }
        return state as AppSettingsTimestampStore;
      },
    },
  ),
);

// Only a leaf this device syncs moves the clocks; unsynced leaves would republish stale values as newest.
export function touchAppSetting(id: string): void {
  const synced = settingKey(id) !== undefined && useSyncPrefsStore.getState().isSettingSynced(id);
  if (synced || remoteApplyTimestamp() !== null) useAppSettingsTimestampStore.getState().touch([relPath(id)]);
}
