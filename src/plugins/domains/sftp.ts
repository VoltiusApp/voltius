import {
  sftpClose, sftpCanonicalize, sftpListDir, sftpMkdir, sftpRename,
  sftpDelete, sftpReadFile, sftpWriteFile, sftpUpload, sftpUploadDir, sftpDownload,
  sftpDownloadDir, sftpTransfer, sftpTransferDir,
  fsListDir, fsMkdir, fsRename, fsDelete, fsCopy, fsReadFile,
} from "@/services/sftp";
import { connectFileBackend } from "@/services/sftpTarget";
import { invoke } from "@/lib/invoke";
import { listen } from "@tauri-apps/api/event";
import { BackendError } from "@/services/backendErrors";
import type { Connection } from "@/types";
import type { PluginFile, SftpAPI, FileEndpoint } from "../api";

/** The pseudo-target naming this machine rather than a saved connection. */
export const LOCAL_TARGET = "local";

const DEFAULT_MAX_READ_BYTES = 256 * 1024;

/**
 * File access over the same backend the SFTP tab drives.
 *
 * FTP, WebDAV and SFTP all resolve to one opaque `sftpId` and share every `sftp_*`
 * command, so a single target model covers both — the only divergence is which
 * connect call opens the handle. `"local"` is a target too, dispatching to the
 * `fs_*` commands, which is what lets one `transfer` verb express every
 * direction the SFTP tab offers.
 *
 * Handles are opened lazily per target and cached for the plugin's lifetime;
 * one that stops answering is reopened in place, and `dispose` closes them, so
 * an unloaded plugin cannot leave connections open.
 */
export function createSftpAPI(
  findConnection: (id: string) => Connection | undefined,
): SftpAPI & { dispose(): void } {
  const handles = new Map<string, Promise<string>>();
  const healing = new Map<string, Promise<string>>();
  const watchers = new Map<string, Promise<() => void>>();

  const openHandle = async (target: string, relink?: string): Promise<string> => {
    const conn = findConnection(target);
    if (!conn) throw new Error(`Unknown connection "${target}"`);
    return connectFileBackend(conn, crypto.randomUUID(), false, relink);
  };

  const release = (id: string): Promise<void> => {
    const watcher = watchers.get(id);
    watchers.delete(id);
    void watcher?.then((stop) => stop()).catch(() => {});
    return sftpClose(id).catch(() => {});
  };

  /** Relinks into the lost id where the backend can, so transfers waiting on it resume.
   *  On failure the lost id stays cached, and the next call relinks into it again. */
  const heal = (target: string, lost: string): Promise<string> => {
    const pending = healing.get(lost);
    if (pending) return pending;
    const reopened = openHandle(target, lost)
      .then((id) => {
        if (id !== lost) {
          void release(lost);
          if (handles.has(target)) {
            handles.set(target, Promise.resolve(id));
            watch(target, id);
          } else {
            void release(id);
          }
        }
        return id;
      })
      .catch((err: unknown) => {
        const name = findConnection(target)?.name ?? target;
        throw new BackendError(
          "connection-lost",
          `Lost the connection to "${name}" and could not reopen it: ${String(err)}`,
        );
      })
      .finally(() => healing.delete(lost));
    healing.set(lost, reopened);
    return reopened;
  };

  const watch = (target: string, id: string): void => {
    if (watchers.has(id)) return;
    watchers.set(id, listen(`sftp-closed-${id}`, () => {
      void heal(target, id).catch(() => {});
    }));
  };

  /** A failed open is not cached, so one transient failure cannot poison the target. */
  const handleFor = (target: string): Promise<string> => {
    const existing = handles.get(target);
    if (existing) return existing;
    const opening: Promise<string> = openHandle(target).then(
      (id) => {
        watch(target, id);
        return id;
      },
      (err: unknown) => {
        if (handles.get(target) === opening) handles.delete(target);
        throw err;
      },
    );
    handles.set(target, opening);
    return opening;
  };

  const answers = (id: string): Promise<boolean> =>
    sftpCanonicalize(id, ".").then(() => true, () => false);

  /** Retries `op` once when it fails and one of its handles no longer answers; a
   *  failure on handles that still answer is the operation's own and surfaces as is. */
  const onRemote = async <T>(targets: string[], op: (ids: string[]) => Promise<T>): Promise<T> => {
    const ids = await Promise.all(targets.map(handleFor));
    try {
      return await op(ids);
    } catch (err) {
      const alive = await Promise.all(ids.map(answers));
      if (alive.every(Boolean)) throw err;
      return op(await Promise.all(targets.map((t, i) => (alive[i] ? ids[i] : heal(t, ids[i])))));
    }
  };

  const evictHandle = async (target: string): Promise<void> => {
    const handle = handles.get(target);
    if (!handle) return;
    handles.delete(target);
    const id = await handle.catch(() => null);
    if (id !== null) await release(id);
  };

  const isLocal = (target: string) => target === LOCAL_TARGET;

  /**
   * Reject an unresolvable target loudly, before any verb can turn it into a
   * vaguer failure downstream. A model reaching for a hostname or an IP instead
   * of the opaque connection id is the common case, and `stat` swallowing that
   * into a null made it surface as "No such path", pointing at the path rather
   * than at the target that was actually wrong.
   */
  const assertTarget = (target: string): void => {
    if (isLocal(target) || findConnection(target)) return;
    throw new Error(
      `Unknown file target "${target}" — use "local" or an id from the connection list, not a hostname`,
    );
  };

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

  const onTarget = <T>(
    target: string,
    local: () => Promise<T>,
    remote: (sftpId: string) => Promise<T>,
  ): Promise<T> => {
    assertTarget(target);
    return isLocal(target) ? local() : onRemote([target], ([id]) => remote(id));
  };

  const api: SftpAPI & { dispose(): void } = {
    async list(target, path) {
      const files = await onTarget(target, () => fsListDir(path), (id) => sftpListDir(id, path));
      return files.map(toPluginFile);
    },

    // Derived from the parent listing rather than a stat command: `sftp_stat`
    // and `fs_stat` answer only "does this exist", with no size or is_dir, and
    // every caller here needs is_dir to pick a transfer variant.
    async stat(target, path) {
      assertTarget(target);
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
      } catch (err) {
        // A missing or unreadable parent means "no such path"; a lost connection does not.
        if (err instanceof BackendError && err.code === "connection-lost") throw err;
        return null;
      }
    },

    async readText(target, path, maxBytes = DEFAULT_MAX_READ_BYTES) {
      const file = await onTarget(
        target,
        () => fsReadFile(path, maxBytes),
        (id) => sftpReadFile(id, path, maxBytes),
      );
      return file.content;
    },

    async writeText(target, path, content) {
      await onTarget(
        target,
        () => invoke("fs_write_file", { path, content }),
        (id) => sftpWriteFile(id, path, content),
      );
    },

    async mkdir(target, path) {
      return onTarget(target, () => fsMkdir(path), (id) => sftpMkdir(id, path));
    },

    async rename(target, from, to) {
      return onTarget(target, () => fsRename(from, to), (id) => sftpRename(id, from, to));
    },

    async delete(target, path) {
      return onTarget(target, () => fsDelete(path), (id) => sftpDelete(id, path));
    },

    async transfer(src: FileEndpoint, dst: FileEndpoint, callerTransferId?: string) {
      assertTarget(src.target);
      assertTarget(dst.target);
      const transferId = callerTransferId ?? crypto.randomUUID();
      const dir = await isDirAt(src.target, src.path);

      if (isLocal(src.target) && isLocal(dst.target)) {
        return fsCopy(src.path, dst.path, transferId);
      }
      if (isLocal(src.target)) {
        return onRemote([dst.target], ([sftpId]) => {
          const params = { sftpId, localPath: src.path, remotePath: dst.path, transferId };
          return dir ? sftpUploadDir(params) : sftpUpload(params);
        });
      }
      if (isLocal(dst.target)) {
        return onRemote([src.target], ([sftpId]) => {
          const params = { sftpId, remotePath: src.path, localPath: dst.path, transferId };
          return dir ? sftpDownloadDir(params) : sftpDownload(params);
        });
      }
      // Pipes backend to backend in Rust for every pairing, so the bytes never touch local disk.
      return onRemote([src.target, dst.target], ([srcSftpId, dstSftpId]) => {
        const params = { srcSftpId, srcPath: src.path, dstSftpId, dstPath: dst.path, transferId };
        return dir ? sftpTransferDir(params) : sftpTransfer(params);
      });
    },

    async disconnect(target) {
      await evictHandle(target);
    },

    dispose() {
      for (const target of [...handles.keys()]) void evictHandle(target);
    },
  };

  return api;
}
