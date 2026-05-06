import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";

export interface RemoteFile {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  is_symlink: boolean;
  modified: number | null;
  permissions: number | null;
}

export interface LocalFile {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  modified: number | null;
}

export interface TransferProgress {
  transferred: number;
  total: number;
}

// ── Session ────────────────────────��──────────────────────────────────────────

/** Standalone SFTP connection — creates its own SSH connection, no terminal session needed. */
export async function sftpConnect(params: {
  connectId: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  jumpHosts?: Array<{ host: string; port: number; username: string; password?: string; privateKey?: string }>;
}): Promise<string> {
  return invoke("sftp_connect", {
    connectId: params.connectId,
    host: params.host,
    port: params.port,
    username: params.username,
    password: params.password ?? null,
    privateKey: params.privateKey ?? null,
    jumpHosts: params.jumpHosts ?? null,
  });
}

export async function sftpOpen(sessionId: string): Promise<string> {
  return invoke("sftp_open", { sessionId });
}

export async function sftpClose(sftpId: string): Promise<void> {
  return invoke("sftp_close", { sftpId });
}

// ── Browse ────────────────────────────────���───────────────────────────────────

export async function sftpListDir(sftpId: string, path: string): Promise<RemoteFile[]> {
  return invoke("sftp_list_dir", { sftpId, path });
}

export async function sftpCanonicalize(sftpId: string, path: string): Promise<string> {
  return invoke("sftp_canonicalize", { sftpId, path });
}

export async function sftpMkdir(sftpId: string, path: string): Promise<void> {
  return invoke("sftp_mkdir", { sftpId, path });
}

export async function sftpTouch(sftpId: string, path: string): Promise<void> {
  return invoke("sftp_touch", { sftpId, path });
}

export async function sftpRename(sftpId: string, from: string, to: string): Promise<void> {
  return invoke("sftp_rename", { sftpId, from, to });
}

export async function sftpDelete(sftpId: string, path: string): Promise<void> {
  return invoke("sftp_delete", { sftpId, path });
}

// ── Transfer ──────────────────────────────��──────────────────────────────���────

export async function sftpUpload(params: {
  sftpId: string;
  localPath: string;
  remotePath: string;
  transferId: string;
}): Promise<void> {
  return invoke("sftp_upload", {
    sftpId: params.sftpId,
    localPath: params.localPath,
    remotePath: params.remotePath,
    transferId: params.transferId,
  });
}

export async function sftpDownload(params: {
  sftpId: string;
  remotePath: string;
  localPath: string;
  transferId: string;
}): Promise<void> {
  return invoke("sftp_download", {
    sftpId: params.sftpId,
    remotePath: params.remotePath,
    localPath: params.localPath,
    transferId: params.transferId,
  });
}

export async function sftpUploadDir(params: {
  sftpId: string;
  localPath: string;
  remotePath: string;
  transferId: string;
}): Promise<void> {
  return invoke("sftp_upload_dir", {
    sftpId: params.sftpId,
    localPath: params.localPath,
    remotePath: params.remotePath,
    transferId: params.transferId,
  });
}

export async function sftpDownloadDir(params: {
  sftpId: string;
  remotePath: string;
  localPath: string;
  transferId: string;
}): Promise<void> {
  return invoke("sftp_download_dir", {
    sftpId: params.sftpId,
    remotePath: params.remotePath,
    localPath: params.localPath,
    transferId: params.transferId,
  });
}

export async function sftpCancelTransfer(transferId: string): Promise<void> {
  return invoke("sftp_cancel_transfer", { transferId });
}

/** Remote → Remote: transfer a single file between two SFTP sessions. */
export async function sftpTransfer(params: {
  srcSftpId: string;
  srcPath: string;
  dstSftpId: string;
  dstPath: string;
  transferId: string;
}): Promise<void> {
  return invoke("sftp_transfer", {
    srcSftpId: params.srcSftpId,
    srcPath: params.srcPath,
    dstSftpId: params.dstSftpId,
    dstPath: params.dstPath,
    transferId: params.transferId,
  });
}

/** Remote → Remote: transfer a directory recursively between two SFTP sessions. */
export async function sftpTransferDir(params: {
  srcSftpId: string;
  srcPath: string;
  dstSftpId: string;
  dstPath: string;
  transferId: string;
}): Promise<void> {
  return invoke("sftp_transfer_dir", {
    srcSftpId: params.srcSftpId,
    srcPath: params.srcPath,
    dstSftpId: params.dstSftpId,
    dstPath: params.dstPath,
    transferId: params.transferId,
  });
}

/** Open a native OS file/folder picker. Returns the selected path or null. */
export async function pickLocalPath(opts: { directory?: boolean; title?: string } = {}): Promise<string | null> {
  const result = await dialogOpen({
    directory: opts.directory ?? false,
    multiple: false,
    title: opts.title,
  });
  if (Array.isArray(result)) return result[0] ?? null;
  return result;
}

export async function onTransferProgress(
  transferId: string,
  callback: (progress: TransferProgress) => void,
): Promise<UnlistenFn> {
  return listen<TransferProgress>(`sftp-progress-${transferId}`, (e) =>
    callback(e.payload),
  );
}

// ── Local FS ─────────────────────��────────────────────────────────────────────

export async function fsHomeDir(): Promise<string> {
  return invoke("fs_home_dir");
}

export async function fsListDir(path: string): Promise<LocalFile[]> {
  return invoke("fs_list_dir", { path });
}

export async function fsMkdir(path: string): Promise<void> {
  return invoke("fs_mkdir", { path });
}

export async function fsRename(from: string, to: string): Promise<void> {
  return invoke("fs_rename", { from, to });
}

export async function fsDelete(path: string): Promise<void> {
  return invoke("fs_delete", { path });
}

export async function fsTouch(path: string): Promise<void> {
  return invoke("fs_touch", { path });
}

/** Returns true if path exists on the remote, false otherwise. */
export async function sftpExists(sftpId: string, path: string): Promise<boolean> {
  const result: boolean | null = await invoke("sftp_stat", { sftpId, path });
  return result !== null;
}

/** Returns true if path exists on the local filesystem. */
export async function fsExists(path: string): Promise<boolean> {
  const result: boolean | null = await invoke("fs_stat", { path });
  return result !== null;
}

// ── Tar-based directory transfer ──────────────────────────────────────────────

export async function sftpUploadDirTar(params: {
  sftpId: string;
  localPath: string;
  remotePath: string;
  transferId: string;
}): Promise<void> {
  return invoke("sftp_upload_dir_tar", {
    sftpId: params.sftpId,
    localPath: params.localPath,
    remotePath: params.remotePath,
    transferId: params.transferId,
  });
}

export async function sftpDownloadDirTar(params: {
  sftpId: string;
  remotePath: string;
  localPath: string;
  transferId: string;
}): Promise<void> {
  return invoke("sftp_download_dir_tar", {
    sftpId: params.sftpId,
    remotePath: params.remotePath,
    localPath: params.localPath,
    transferId: params.transferId,
  });
}

export async function sftpTransferDirTar(params: {
  srcSftpId: string;
  srcPath: string;
  dstSftpId: string;
  dstPath: string;
  transferId: string;
}): Promise<void> {
  return invoke("sftp_transfer_dir_tar", {
    srcSftpId: params.srcSftpId,
    srcPath: params.srcPath,
    dstSftpId: params.dstSftpId,
    dstPath: params.dstPath,
    transferId: params.transferId,
  });
}

export async function sftpUploadBatchTar(params: {
  sftpId: string;
  localPaths: string[];
  remoteDir: string;
  transferId: string;
}): Promise<void> {
  return invoke("sftp_upload_batch_tar", {
    sftpId: params.sftpId,
    localPaths: params.localPaths,
    remoteDir: params.remoteDir,
    transferId: params.transferId,
  });
}

export async function sftpDownloadBatchTar(params: {
  sftpId: string;
  remotePaths: string[];
  localDir: string;
  transferId: string;
}): Promise<void> {
  return invoke("sftp_download_batch_tar", {
    sftpId: params.sftpId,
    remotePaths: params.remotePaths,
    localDir: params.localDir,
    transferId: params.transferId,
  });
}

export async function sftpTransferBatchTar(params: {
  srcSftpId: string;
  srcPaths: string[];
  dstSftpId: string;
  dstDir: string;
  transferId: string;
}): Promise<void> {
  return invoke("sftp_transfer_batch_tar", {
    srcSftpId: params.srcSftpId,
    srcPaths: params.srcPaths,
    dstSftpId: params.dstSftpId,
    dstDir: params.dstDir,
    transferId: params.transferId,
  });
}

// ── Compress / Extract ────────────────────────────────────────────────────────

/** Compress a remote file or directory into a .tar.gz archive via SSH exec. */
export async function sftpCompress(sftpId: string, sourcePath: string, archivePath: string): Promise<void> {
  return invoke("sftp_compress", { sftpId, sourcePath, archivePath });
}

/** Extract a remote .tar.gz archive into a destination directory via SSH exec. */
export async function sftpExtract(sftpId: string, archivePath: string, destDir: string): Promise<void> {
  return invoke("sftp_extract", { sftpId, archivePath, destDir });
}

/** Compress a local file or directory into a .tar.gz archive. */
export async function fsCompress(sourcePath: string, archivePath: string): Promise<void> {
  return invoke("fs_compress", { sourcePath, archivePath });
}

/** Extract a local .tar.gz archive into a destination directory. */
export async function fsExtract(archivePath: string, destDir: string): Promise<void> {
  return invoke("fs_extract", { archivePath, destDir });
}
