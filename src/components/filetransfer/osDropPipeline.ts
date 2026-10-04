import { invoke } from "@/lib/invoke";
import i18n from "@/i18n";
import {
  sftpUploadBatchTar, sftpDownloadBatchTar,
  sftpExists, fsExists,
} from "@/services/sftp";
import { transferItem } from "@/services/sftpTransferCore";
import { useTransferQueueStore } from "@/stores/transferQueueStore";
import { accelFor, tarMode } from "./tarSupport";
import { joinPath } from "./moveTargetCore";
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

export function batchLabel(files: FileEntry[]): string {
  return files.length === 1 ? files[0].name : i18n.t("fileTransfer.common.itemsCount", { count: files.length });
}

async function uploadEntries(files: FileEntry[], target: UploadTarget): Promise<void> {
  const { runTransfer } = useTransferQueueStore.getState();
  if (!target.isLocal && !target.sftpId) return;
  const mode = !target.isLocal && target.sftpId ? await tarMode([target.sftpId]) : "off";
  const useTar = mode === "tar";

  if (useTar && target.sftpId && files.length > 1) {
    const sftpId = target.sftpId;
    await runTransfer(batchLabel(files), "→", (tid) =>
      sftpUploadBatchTar({ sftpId, localPaths: files.map((f) => f.path), remoteDir: target.cwd, transferId: tid }),
      target.onRefresh,
      "tar",
    );
    return;
  }

  for (const file of files) {
    await runTransfer(file.name, "→", (tid) => transferItem({
      from: "local",
      to: target.isLocal ? "local" : "remote",
      dstSftpId: target.sftpId ?? undefined,
      srcPath: file.path,
      dstPath: joinPath(target.cwd, file.name),
      isDir: file.isDir,
      useTar,
      transferId: tid,
    }), target.onRefresh, accelFor(mode, file.isDir));
  }
}

export async function downloadToLocal(files: FileEntry[], sftpId: string, localDir: string): Promise<void> {
  const { runTransfer } = useTransferQueueStore.getState();
  const mode = await tarMode([sftpId]);
  const useTar = mode === "tar";

  if (useTar && files.length > 1) {
    await runTransfer(batchLabel(files), "←", (tid) =>
      sftpDownloadBatchTar({ sftpId, remotePaths: files.map((f) => f.path), localDir, transferId: tid }), undefined, "tar");
    return;
  }

  for (const file of files) {
    await runTransfer(file.name, "←", (tid) => transferItem({
      from: "remote",
      to: "local",
      srcSftpId: sftpId,
      srcPath: file.path,
      dstPath: joinPath(localDir, file.name),
      isDir: file.isDir,
      useTar,
      transferId: tid,
    }), undefined, accelFor(mode, file.isDir));
  }
}

/**
 * Run conflict detection for an upload then either prompt the user (via the
 * global pending dialog) or execute directly when there are no conflicts.
 */
export async function triggerUpload(items: FileEntry[], target: UploadTarget): Promise<void> {
  if (items.length === 0) return;
  const conflicts = (
    await Promise.all(items.map(async (f) => {
      const dstPath = joinPath(target.cwd, f.name);
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
