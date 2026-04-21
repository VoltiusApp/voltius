import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SftpSettingsStore {
  autoRefreshEnabled: boolean;
  autoRefreshIntervalMs: number;
  tarTransferEnabled: boolean;
  setAutoRefreshEnabled: (v: boolean) => void;
  setAutoRefreshIntervalMs: (v: number) => void;
  setTarTransferEnabled: (v: boolean) => void;
}

export const useSftpSettingsStore = create<SftpSettingsStore>()(
  persist(
    (set) => ({
      autoRefreshEnabled: true,
      autoRefreshIntervalMs: 2000,
      tarTransferEnabled: true,
      setAutoRefreshEnabled: (v) => set({ autoRefreshEnabled: v }),
      setAutoRefreshIntervalMs: (v) => set({ autoRefreshIntervalMs: v }),
      setTarTransferEnabled: (v) => set({ tarTransferEnabled: v }),
    }),
    { name: "voltius-sftp-settings" },
  ),
);
