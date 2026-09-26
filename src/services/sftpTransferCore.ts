import type { FileEntry } from "@/components/filetransfer/SFTPTypes";
import { joinPath } from "@/components/filetransfer/moveTargetCore";
import {
  fsCopy, sftpUpload, sftpUploadDir, sftpUploadDirTar,
  sftpDownload, sftpDownloadDir, sftpDownloadDirTar,
  sftpTransfer, sftpTransferDir, sftpTransferDirTar,
} from "@/services/sftp";
import type { TransferEndpoint } from "@/types";

export interface TransferTarget { srcPath: string; dstPath: string; isDir: boolean; name: string; }

/** Map selected entries to copy targets under destDir. */
export function buildTransferTargets(selected: FileEntry[], destDir: string): TransferTarget[] {
  return selected.map((f) => ({ srcPath: f.path, dstPath: joinPath(destDir, f.name), isDir: f.isDir, name: f.name }));
}

export interface TransferItemArgs {
  from: TransferEndpoint;
  to: TransferEndpoint;
  srcSftpId?: string;
  dstSftpId?: string;
  srcPath: string;
  dstPath: string;
  isDir: boolean;
  useTar: boolean;
  transferId: string;
}

/** Single-item transfer routed to the right primitive by endpoint pair.
 *  Shared by the SFTP page and the snippet engine so both use one table. */
export async function transferItem(a: TransferItemArgs): Promise<void> {
  const { from, to, srcSftpId, dstSftpId, srcPath, dstPath, isDir, useTar, transferId } = a;

  if (from === "local" && to === "local") {
    return fsCopy(srcPath, dstPath, transferId);
  }
  if (from === "local" && to === "remote") {
    if (!dstSftpId) throw new Error("transferItem: missing dstSftpId");
    if (isDir) {
      return useTar
        ? sftpUploadDirTar({ sftpId: dstSftpId, localPath: srcPath, remotePath: dstPath, transferId })
        : sftpUploadDir({ sftpId: dstSftpId, localPath: srcPath, remotePath: dstPath, transferId });
    }
    return sftpUpload({ sftpId: dstSftpId, localPath: srcPath, remotePath: dstPath, transferId });
  }
  if (from === "remote" && to === "local") {
    if (!srcSftpId) throw new Error("transferItem: missing srcSftpId");
    if (isDir) {
      return useTar
        ? sftpDownloadDirTar({ sftpId: srcSftpId, remotePath: srcPath, localPath: dstPath, transferId })
        : sftpDownloadDir({ sftpId: srcSftpId, remotePath: srcPath, localPath: dstPath, transferId });
    }
    return sftpDownload({ sftpId: srcSftpId, remotePath: srcPath, localPath: dstPath, transferId });
  }
  // remote → remote
  if (!srcSftpId || !dstSftpId) throw new Error("transferItem: missing remote channel");
  if (isDir) {
    return useTar
      ? sftpTransferDirTar({ srcSftpId, srcPath, dstSftpId, dstPath, transferId })
      : sftpTransferDir({ srcSftpId, srcPath, dstSftpId, dstPath, transferId });
  }
  return sftpTransfer({ srcSftpId, srcPath, dstSftpId, dstPath, transferId });
}
