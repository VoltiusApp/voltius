import {
  sftpConnect, ftpConnect, sftpClose, sftpListDir, sftpMkdir, sftpRename,
  sftpDelete, sftpReadFile, sftpWriteFile, sftpUpload, sftpUploadDir, sftpDownload,
  sftpDownloadDir, sftpTransfer, sftpTransferDir,
  fsListDir, fsMkdir, fsRename, fsDelete, fsCopy, fsReadFile,
} from "@/services/sftp";
import { resolveConnectionCredentials, resolveJumpHosts } from "@/services/credentials";
import { resolveKeepalive } from "@/utils/keepalive";
import { getGlobalKeepalivePreset } from "@/stores/connectivitySettingsStore";
import { invoke } from "@tauri-apps/api/core";
import type { Connection } from "@/types";
import type { PluginFile, SftpAPI, FileEndpoint } from "../api";

/** The pseudo-target naming this machine rather than a saved connection. */
export const LOCAL_TARGET = "local";

const DEFAULT_MAX_READ_BYTES = 256 * 1024;

/**
 * File access over the same backend the SFTP tab drives.
 *
 * FTP and SFTP both resolve to one opaque `sftpId` and share every `sftp_*`
 * command, so a single target model covers both — the only divergence is which
 * connect call opens the handle. `"local"` is a target too, dispatching to the
 * `fs_*` commands, which is what lets one `transfer` verb express every
 * direction the SFTP tab offers.
 *
 * Handles are opened lazily per target and cached for the plugin's lifetime;
 * `dispose` closes them, so an unloaded plugin cannot leave connections open.
 */
export function createSftpAPI(
  findConnection: (id: string) => Connection | undefined,
): SftpAPI & { dispose(): void } {
  const handles = new Map<string, Promise<string>>();

  const openHandle = async (target: string): Promise<string> => {
    const conn = findConnection(target);
    if (!conn) throw new Error(`Unknown connection "${target}"`);
    if (conn.connection_type === "ftp") {
      const creds = await resolveConnectionCredentials(conn);
      return ftpConnect({
        host: conn.host,
        port: conn.port,
        username: creds.username,
        password: creds.password,
        secure: !!conn.ftp_secure,
      });
    }
    const [creds, jumpHosts] = await Promise.all([
      resolveConnectionCredentials(conn),
      resolveJumpHosts(conn),
    ]);
    const ka = resolveKeepalive(conn.keepalive_preset ?? getGlobalKeepalivePreset());
    return sftpConnect({
      connectId: crypto.randomUUID(),
      host: conn.host,
      port: conn.port,
      username: creds.username,
      password: creds.password,
      privateKey: creds.privateKey,
      passphrase: creds.passphrase,
      jumpHosts: jumpHosts.length > 0 ? jumpHosts : undefined,
      keepaliveIntervalSecs: ka.intervalSecs,
      keepaliveMax: ka.max,
    });
  };

  /** Cached by target so repeated calls reuse one connection, and a failed
   *  open is not cached — otherwise one transient failure would poison the
   *  target for the rest of the plugin's life. */
  const handleFor = (target: string): Promise<string> => {
    const existing = handles.get(target);
    if (existing) return existing;
    const opening = openHandle(target).catch((err) => {
      handles.delete(target);
      throw err;
    });
    handles.set(target, opening);
    return opening;
  };

  const isLocal = (target: string) => target === LOCAL_TARGET;

  const toPluginFile = (f: {
    name: string; path: string; size: number; is_dir: boolean;
    is_symlink?: boolean; modified: number | null;
  }): PluginFile => ({
    name: f.name,
    path: f.path,
    size: f.size,
    isDir: f.is_dir,
    isSymlink: !!f.is_symlink,
    modified: f.modified,
  });

  const isDirAt = async (target: string, path: string): Promise<boolean> => {
    const entry = await api.stat(target, path);
    if (!entry) throw new Error(`No such path "${path}" on "${target}"`);
    return entry.isDir;
  };

  const api: SftpAPI & { dispose(): void } = {
    async list(target, path) {
      if (isLocal(target)) return (await fsListDir(path)).map(toPluginFile);
      return (await sftpListDir(await handleFor(target), path)).map(toPluginFile);
    },

    // Derived from the parent listing rather than a stat command: `sftp_stat`
    // and `fs_stat` answer only "does this exist", with no size or is_dir, and
    // every caller here needs is_dir to pick a transfer variant.
    async stat(target, path) {
      const normalised = path.replace(/\/+$/, "");
      if (normalised === "") {
        return { name: "/", path: "/", size: 0, isDir: true, isSymlink: false, modified: null };
      }
      const cut = normalised.lastIndexOf("/");
      const parent = cut <= 0 ? "/" : normalised.slice(0, cut);
      const base = normalised.slice(cut + 1);
      try {
        const entries = await api.list(target, parent);
        return entries.find((e) => e.name === base) ?? null;
      } catch {
        // An unreadable or missing parent is a normal answer here, not a
        // failure: every caller that needs the distinction checks for null.
        return null;
      }
    },

    async readText(target, path, maxBytes = DEFAULT_MAX_READ_BYTES) {
      const file = isLocal(target)
        ? await fsReadFile(path, maxBytes)
        : await sftpReadFile(await handleFor(target), path, maxBytes);
      return file.content;
    },

    async writeText(target, path, content) {
      if (isLocal(target)) {
        await invoke("fs_write_file", { path, content });
        return;
      }
      await sftpWriteFile(await handleFor(target), path, content);
    },

    async mkdir(target, path) {
      if (isLocal(target)) return fsMkdir(path);
      return sftpMkdir(await handleFor(target), path);
    },

    async rename(target, from, to) {
      if (isLocal(target)) return fsRename(from, to);
      return sftpRename(await handleFor(target), from, to);
    },

    async delete(target, path) {
      if (isLocal(target)) return fsDelete(path);
      return sftpDelete(await handleFor(target), path);
    },

    async transfer(src: FileEndpoint, dst: FileEndpoint) {
      const transferId = crypto.randomUUID();
      const dir = await isDirAt(src.target, src.path);

      if (isLocal(src.target) && isLocal(dst.target)) {
        return fsCopy(src.path, dst.path, transferId);
      }
      if (isLocal(src.target)) {
        const sftpId = await handleFor(dst.target);
        const params = { sftpId, localPath: src.path, remotePath: dst.path, transferId };
        return dir ? sftpUploadDir(params) : sftpUpload(params);
      }
      if (isLocal(dst.target)) {
        const sftpId = await handleFor(src.target);
        const params = { sftpId, remotePath: src.path, localPath: dst.path, transferId };
        return dir ? sftpDownloadDir(params) : sftpDownload(params);
      }
      const [srcSftpId, dstSftpId] = await Promise.all([
        handleFor(src.target),
        handleFor(dst.target),
      ]);
      const params = { srcSftpId, srcPath: src.path, dstSftpId, dstPath: dst.path, transferId };
      return dir ? sftpTransferDir(params) : sftpTransfer(params);
    },

    async disconnect(target) {
      const handle = handles.get(target);
      if (!handle) return;
      handles.delete(target);
      await sftpClose(await handle).catch(() => {});
    },

    dispose() {
      for (const [target, handle] of handles) {
        handles.delete(target);
        void handle.then((id) => sftpClose(id)).catch(() => {});
      }
    },
  };

  return api;
}
