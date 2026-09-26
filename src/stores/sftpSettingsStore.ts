import { create } from "zustand";
import { persist } from "zustand/middleware";
import { touchAppSetting } from "./appSettingsTimestampStore";
import {
  DEFAULT_COLUMN_WIDTHS, DEFAULT_VISIBLE_COLS,
  type ColumnWidths, type VisibleCols,
} from "@/components/filetransfer/SFTPTypes";

export const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 2000;
export const DEFAULT_EDITOR_MAX_BYTES = 5 * 1024 * 1024;

interface SftpSettingsStore {
  autoRefreshIntervalMs: number;
  setAutoRefreshIntervalMs: (v: number) => void;
  editorAutoSave: boolean;
  setEditorAutoSave: (v: boolean) => void;
  editorMaxBytes: number;
  setEditorMaxBytes: (n: number) => void;
  /** Show dotfiles in file panes. Persisted so the choice sticks across panes,
   *  sessions, and relaunches (as mainstream SFTP clients do). */
  showHidden: boolean;
  setShowHidden: (v: boolean) => void;
  /** Column widths and per-column visibility. Persisted and shared by every pane
   *  for the same reason as `showHidden`: a pane remount used to throw them away. */
  columnWidths: ColumnWidths;
  setColumnWidths: (update: Updater<ColumnWidths>) => void;
  visibleColumns: VisibleCols;
  setVisibleColumns: (update: Updater<VisibleCols>) => void;
}

type Updater<T> = T | ((prev: T) => T);

const applyUpdate = <T,>(update: Updater<T>, prev: T): T =>
  typeof update === "function" ? (update as (p: T) => T)(prev) : update;

// Every setter reports its leaf; the settings registry decides whether it syncs.
const touchSftp = (key: keyof SftpSettingsStore) => touchAppSetting(`appSettings.sftp.${key}`);

export const useSftpSettingsStore = create<SftpSettingsStore>()(
  persist(
    (set) => ({
      autoRefreshIntervalMs: DEFAULT_AUTO_REFRESH_INTERVAL_MS,
      setAutoRefreshIntervalMs: (v) => { set({ autoRefreshIntervalMs: v }); touchSftp("autoRefreshIntervalMs"); },
      editorAutoSave: false,
      setEditorAutoSave: (v) => { set({ editorAutoSave: v }); touchSftp("editorAutoSave"); },
      editorMaxBytes: DEFAULT_EDITOR_MAX_BYTES,
      setEditorMaxBytes: (n) => { set({ editorMaxBytes: n }); touchSftp("editorMaxBytes"); },
      showHidden: false,
      setShowHidden: (v) => { set({ showHidden: v }); touchSftp("showHidden"); },
      columnWidths: DEFAULT_COLUMN_WIDTHS,
      setColumnWidths: (update) => { set((s) => ({ columnWidths: applyUpdate(update, s.columnWidths) })); touchSftp("columnWidths"); },
      visibleColumns: DEFAULT_VISIBLE_COLS,
      setVisibleColumns: (update) => { set((s) => ({ visibleColumns: applyUpdate(update, s.visibleColumns) })); touchSftp("visibleColumns"); },
    }),
    { name: "voltius-sftp-settings" },
  ),
);
