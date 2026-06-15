import { invoke } from "@tauri-apps/api/core";

export interface DownloadDirInfo {
  uri: string;
  displayName: string | null;
}

/** The configured Android SFTP download folder, or null if none is set. */
export function downloadDirGet(): Promise<DownloadDirInfo | null> {
  return invoke<DownloadDirInfo | null>("download_dir_get");
}

/** Launch the SAF folder picker; resolves to the chosen folder, or null if cancelled. */
export function downloadDirPick(): Promise<DownloadDirInfo | null> {
  return invoke<DownloadDirInfo | null>("download_dir_pick");
}

export function downloadDirClear(): Promise<void> {
  return invoke("download_dir_clear");
}

/** A unique temp path the SFTP download writes to before publishing into the SAF tree. */
export function downloadTempPath(transferId: string, name: string): Promise<string> {
  return invoke<string>("download_temp_path", { transferId, name });
}

/** Move a finished temp download into the SAF tree under `baseName`, then delete the temp. */
export function downloadPublish(tempPath: string, baseName: string): Promise<void> {
  return invoke("download_publish", { tempPath, baseName });
}
