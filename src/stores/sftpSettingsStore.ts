import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";

interface SftpSettingsStore {
  autoRefreshIntervalMs: number;
  setAutoRefreshIntervalMs: (v: number) => void;
}

export const useSftpSettingsStore = create<SftpSettingsStore>()(
  persist(
    (set) => ({
      autoRefreshIntervalMs: 2000,
      setAutoRefreshIntervalMs: (v) => { set({ autoRefreshIntervalMs: v }); useAppSettingsTimestampStore.getState().touch(); },
    }),
    { name: "voltius-sftp-settings" },
  ),
);
