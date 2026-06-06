import { invoke } from "@tauri-apps/api/core";
import {
  sftpUpload, sftpUploadDir, sftpUploadDirTar, sftpUploadBatchTar,
  sftpExists, fsExists, fsCopy,
} from "@/services/sftp";
import { useTransferQueueStore } from "@/stores/transferQueueStore";
import { tarUsable } from "./tarSupport";
import { type FileEntry } from "./SFTPTypes";

export type UploadTarget = {
  isLocal: boolean;
  sftpId: string | null;
  cwd: string;
  /** Called after each completed transfer so the UI can refresh its listing. */
  onRefresh?: () => void;
};

/** Stat raw OS paths to determine file vs directory; skips unreadable items. */
async function statOsPaths(paths: string[]): Promise<FileEntry[]> {
  const items: FileEntry[] = [];
  for (const p of paths) {
    try {
      const isDir = await invoke<boolean | null>("fs_stat", { path: p });
      if (isDir === null) continue;
      const name = p.split(/[\\/]/).filter(Boolean).pop() ?? p;
      items.push({ name, path: p, size: 0, isDir });
    } catch { /* skip unreadable */ }
  }
  return items;
}

async function uploadEntries(files: FileEntry[], target: UploadTarget): Promise<void> {
  const { runTransfer } = useTransferQueueStore.getState();
  const dstBase = target.cwd.replace(/\/$/, "");
  // Tar archives locally + extracts remotely, so both ends need tar; local targets use fsCopy.
  const useTar = !target.isLocal && target.sftpId ? await tarUsable([target.sftpId], true) : false;

  if (useTar && target.sftpId && files.length > 1) {
    const sftpId = target.sftpId;
    const label = `${files.length} items`;
    await runTransfer(label, "→", (tid) =>
      sftpUploadBatchTar({ sftpId, localPaths: files.map((f) => f.path), remoteDir: dstBase, transferId: tid }),
      target.onRefresh,
    );
    return;
  }

  for (const file of files) {
    const destPath = `${dstBase}/${file.name}`;
    if (target.isLocal) {
      await runTransfer(file.name, "→", (tid) => fsCopy(file.path, destPath, tid), target.onRefresh);
    } else if (target.sftpId) {
      const sftpId = target.sftpId;
      await runTransfer(file.name, "→", (tid) => file.isDir
        ? (useTar
            ? sftpUploadDirTar({ sftpId, localPath: file.path, remotePath: destPath, transferId: tid })
            : sftpUploadDir({ sftpId, localPath: file.path, remotePath: destPath, transferId: tid }))
        : sftpUpload({ sftpId, localPath: file.path, remotePath: destPath, transferId: tid }),
        target.onRefresh,
      );
    }
  }
}

/**
 * Run conflict detection for an upload then either prompt the user (via the
 * global pending dialog) or execute directly when there are no conflicts.
 */
export async function triggerUpload(items: FileEntry[], target: UploadTarget): Promise<void> {
  if (items.length === 0) return;
  const dstBase = target.cwd.replace(/\/$/, "");
  const conflicts = (
    await Promise.all(items.map(async (f) => {
      const dstPath = `${dstBase}/${f.name}`;
      const exists = target.isLocal ? await fsExists(dstPath) : await sftpExists(target.sftpId!, dstPath);
      return exists ? f : null;
    }))
  ).filter((f): f is FileEntry => f !== null);

  const conflictPaths = new Set(conflicts.map((f) => f.path));
  const toTransfer = items.filter((f) => !conflictPaths.has(f.path));

  if (conflicts.length > 0) {
    useTransferQueueStore.getState().setPending({
      conflicts,
      toTransfer,
      totalConflicts: conflicts.length,
      execute: (files) => void uploadEntries(files, target),
    });
    return;
  }

  void uploadEntries(items, target);
}

/** Entry point for OS-originated drops (Tauri onDragDropEvent). */
export async function triggerOsDrop(paths: string[], target: UploadTarget): Promise<void> {
  const items = await statOsPaths(paths);
  await triggerUpload(items, target);
}
