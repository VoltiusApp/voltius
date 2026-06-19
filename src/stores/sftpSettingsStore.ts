import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";

export const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 2000;
export const DEFAULT_EDITOR_MAX_BYTES = 5 * 1024 * 1024;

interface SftpSettingsStore {
  autoRefreshIntervalMs: number;
  setAutoRefreshIntervalMs: (v: number) => void;
  editorAutoSave: boolean;
  setEditorAutoSave: (v: boolean) => void;
  editorMaxBytes: number;
  setEditorMaxBytes: (n: number) => void;
}

export const useSftpSettingsStore = create<SftpSettingsStore>()(
  persist(
    (set) => ({
      autoRefreshIntervalMs: DEFAULT_AUTO_REFRESH_INTERVAL_MS,
      setAutoRefreshIntervalMs: (v) => { set({ autoRefreshIntervalMs: v }); useAppSettingsTimestampStore.getState().touch(); },
      editorAutoSave: false,
      setEditorAutoSave: (v) => { set({ editorAutoSave: v }); useAppSettingsTimestampStore.getState().touch(); },
      editorMaxBytes: DEFAULT_EDITOR_MAX_BYTES,
      setEditorMaxBytes: (n) => { set({ editorMaxBytes: n }); useAppSettingsTimestampStore.getState().touch(); },
    }),
    { name: "voltius-sftp-settings" },
  ),
);
