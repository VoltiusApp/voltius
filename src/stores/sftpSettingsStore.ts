import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";

export const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 2000;

interface SftpSettingsStore {
  autoRefreshIntervalMs: number;
  setAutoRefreshIntervalMs: (v: number) => void;
}

export const useSftpSettingsStore = create<SftpSettingsStore>()(
  persist(
    (set) => ({
      autoRefreshIntervalMs: DEFAULT_AUTO_REFRESH_INTERVAL_MS,
      setAutoRefreshIntervalMs: (v) => { set({ autoRefreshIntervalMs: v }); useAppSettingsTimestampStore.getState().touch(); },
    }),
    { name: "voltius-sftp-settings" },
  ),
);
