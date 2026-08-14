import { create } from "zustand";
import { persist } from "zustand/middleware";
import { pushSettingsChange, settingsStamp } from "./remoteApplyGuard";

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
