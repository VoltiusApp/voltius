import { invoke } from "@/lib/invoke";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { openSystemDialog as dialogOpen } from "@/services/systemDialog";
import type { ProxySpec } from "@/services/proxy";

export interface RemoteFile {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  is_symlink: boolean;
  modified: number | null;
  permissions: number | null;
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
  passphrase?: string;
  jumpHosts?: Array<{ host: string; port: number; username: string; password?: string; privateKey?: string; passphrase?: string }>;
  keepaliveIntervalSecs: number;
  keepaliveMax: number;
  legacyAlgorithms?: boolean;
  proxy?: ProxySpec | null;
  /** A lost session's id to reconnect into, so its transfers resume. */
  relink?: string;
}): Promise<string> {
  return invoke("sftp_connect", {
    connectId: params.connectId,
    host: params.host,
    port: params.port,
    username: params.username,
    password: params.password ?? null,
    privateKey: params.privateKey ?? null,
    passphrase: params.passphrase ?? null,
    jumpHosts: params.jumpHosts ?? null,
    keepaliveIntervalSecs: params.keepaliveIntervalSecs,
    keepaliveMax: params.keepaliveMax,
    legacyAlgorithms: params.legacyAlgorithms ?? false,
    proxy: params.proxy ?? null,
    relink: params.relink ?? null,
  });
}

export async function sftpOpen(sessionId: string): Promise<string> {
  return invoke("sftp_open", { sessionId });
}

/** Standalone FTP / explicit-FTPS connection. Returns an sftpId usable with all sftp* calls. */
export async function ftpConnect(params: {
  host: string;
  port: number;
  username: string;
  password?: string;
  secure: boolean;
}): Promise<string> {
  return invoke("ftp_connect", {
    host: params.host,
    port: params.port,
    username: params.username,
    password: params.password ?? null,
    secure: params.secure,
  });
}

/** Standalone WebDAV connection. `interactive`: a conflict overlay listens on `connectId`. */
export async function webdavConnect(params: {
  connectId: string;
  url: string;
  username: string;
  password?: string;
  proxy?: ProxySpec | null;
  interactive: boolean;
}): Promise<string> {
  return invoke("webdav_connect", {
    connectId: params.connectId,
    url: params.url,
    username: params.username,
    password: params.password ?? null,
    proxy: params.proxy ?? null,
    interactive: params.interactive,
  });
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

export interface OwnerInfo {
  uid: number;
  gid: number;
  user: string;
  group: string;
}

export interface AttrChange {
  paths: string[];
  set: number;
  clear: number;
  owner?: string;
  group?: string;
  recurse?: "all" | "files" | "dirs";
}

/** null when the host has no POSIX shell to report owners. */
export async function sftpOwners(sftpId: string, paths: string[]): Promise<OwnerInfo[] | null> {
  return invoke("sftp_owners", { sftpId, paths });
}

export async function sftpSetAttrs(sftpId: string, change: AttrChange): Promise<void> {
  return invoke("sftp_set_attrs", { sftpId, change });
}

export async function fsOwners(paths: string[]): Promise<OwnerInfo[] | null> {
  return invoke("fs_owners", { paths });
}

export async function fsSetAttrs(change: AttrChange): Promise<void> {
  return invoke("fs_set_attrs", { change });
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

/** Tell the backend the transfer about to run under `transferId` is a retry. */
export async function sftpMarkResume(transferId: string): Promise<void> {
  return invoke("sftp_mark_resume", { transferId });
}

/** True if the session can run commands on its host (false for FTP and WebDAV). */
export async function sftpCanExec(sftpId: string): Promise<boolean> {
  return invoke("sftp_can_exec", { sftpId });
}

/** True if `tar` is available on the remote host. */
export async function sftpTarAvailable(sftpId: string): Promise<boolean> {
  return invoke("sftp_tar_available", { sftpId });
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

/** Open a native OS file picker that allows selecting multiple files. */
export async function pickLocalPaths(opts: { title?: string } = {}): Promise<string[]> {
  const result = await dialogOpen({
    directory: false,
    multiple: true,
    title: opts.title,
  });
  if (Array.isArray(result)) return result;
  return result ? [result] : [];
}

function onTransferEvent<T, R = T>(kind: string, pick: (payload: T) => R = (p) => p as unknown as R) {
  return (transferId: string, callback: (value: R) => void): Promise<UnlistenFn> =>
    listen<T>(`sftp-${kind}-${transferId}`, (e) => callback(pick(e.payload)));
}

export const onTransferProgress = onTransferEvent<TransferProgress>("progress");

/** A remote name the local OS can't hold (or a traversal attempt) that the
 *  backend skipped instead of writing; `path` is its full remote path. */
export const onTransferSkipped = onTransferEvent<string>("skipped");

/** Bytes already in place when an interrupted transfer picked up again. */
export const onTransferResumed = onTransferEvent<{ offset: number }, number>("resumed", (p) => p.offset);

/** The link dropped and the backend is waiting for the session to come back. */
export const onTransferWaiting = onTransferEvent<{ waiting: boolean }, boolean>("waiting", (p) => p.waiting);

/** The backend chose per-file (resumable) over the tar stream the row was started with. */
export const onTransferAccel = onTransferEvent<{ accel: "tar" | "perFile" }, "tar" | "perFile">("accel", (p) => p.accel);

// ── Local FS ─────────────────────��────────────────────────────────────────────

export async function fsHomeDir(): Promise<string> {
  return invoke("fs_home_dir");
}

export async function fsListDir(path: string): Promise<RemoteFile[]> {
  return invoke("fs_list_dir", { path });
}

export async function wslListDistros(): Promise<string[]> {
  return invoke("wsl_list_distros");
}

/** Windows UNC path of a WSL distro's home dir (falls back to the distro root). */
export async function wslHomeDir(distro: string): Promise<string> {
  return invoke("wsl_home_dir", { distro });
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

/** Recursively copy a file or directory on the local filesystem. */
export async function fsCopy(from: string, to: string, transferId: string): Promise<void> {
  return invoke("fs_copy", { from, to, transferId });
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

// ── Editor ────────────────────────────────────────────────────────────────────────

export interface EditorFile {
  content: string;
  size: number;
}

export type EditorReadError =
  | { kind: "too_large"; size: number; limit: number }
  | { kind: "binary" }
  | { kind: "io"; message: string };

export const DEFAULT_EDITOR_MAX_BYTES = 5 * 1024 * 1024;

export async function sftpReadFile(
  sftpId: string,
  path: string,
  maxBytes: number,
): Promise<EditorFile> {
  return invoke("sftp_read_file", { sftpId, path, maxBytes });
}

export async function sftpWriteFile(
  sftpId: string,
  path: string,
  content: string,
): Promise<void> {
  return invoke("sftp_write_file", { sftpId, path, content });
}

export async function fsReadFile(path: string, maxBytes: number): Promise<EditorFile> {
  return invoke("fs_read_file", { path, maxBytes });
}

export async function fsWriteFile(path: string, content: string): Promise<void> {
  return invoke("fs_write_file", { path, content });
}

/** Read a file for the editor through the backend matching the connection kind. */
export function readEditorFile(
  sftpId: string | null,
  path: string,
  maxBytes: number,
): Promise<EditorFile> {
  return sftpId === null ? fsReadFile(path, maxBytes) : sftpReadFile(sftpId, path, maxBytes);
}

/** Write a file for the editor through the backend matching the connection kind. */
export function writeEditorFile(
  sftpId: string | null,
  path: string,
  content: string,
): Promise<void> {
  return sftpId === null ? fsWriteFile(path, content) : sftpWriteFile(sftpId, path, content);
}
