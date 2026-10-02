import { useEffect, useRef, useState } from "react";
import { sftpListDir, fsListDir, type LocalFile, type RemoteFile } from "@/services/sftp";
import type { FileEntry } from "./SFTPTypes";
import { isPlainName } from "./remoteName";
import { backendErrorCode, describeError, type BackendErrorCode } from "@/services/backendErrors";
import i18n from "@/i18n";

const mapLocal = (f: LocalFile): FileEntry => ({ name: f.name, path: f.path, size: f.size, isDir: f.is_dir, modified: f.modified ?? undefined });
const mapRemote = (f: RemoteFile): FileEntry => ({ ...mapLocal(f), permissions: f.permissions ?? undefined, isSymlink: f.is_symlink });

/** Listing of `cwd`, re-read whenever `reloadKey` changes; results for a location the pane has left are dropped. */
export function useDirListing(isLocal: boolean, sftpId: string | null, cwd: string, reloadKey: unknown) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code: BackendErrorCode | null } | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const shownLocation = useRef<string | null>(null);
  const wantedLocation = useRef<string | null>(null);
  const issued = useRef(0);
  const landed = useRef(0);
  const shownFailed = useRef(false);

  useEffect(() => {
    if (!isLocal && !sftpId) return;
    const location = `${isLocal}\n${sftpId}\n${cwd}`;
    wantedLocation.current = location;
    if (shownLocation.current !== location) { setLoading(true); setError(null); setRefreshError(null); }

    // A reload never cancels the one in flight: on a listing slower than auto-refresh, nothing would ever land.
    const seq = ++issued.current;
    const current = () => wantedLocation.current === location && seq > landed.current;
    const land = () => { landed.current = seq; shownLocation.current = location; setLoading(false); };
    const load = isLocal
      ? fsListDir(cwd).then((files) => files.map(mapLocal))
      // The download guard checks a path's last segment, so a name that is not exactly that segment must not be listed.
      : sftpListDir(sftpId!, cwd).then((files) => files.filter((f) => isPlainName(f.name, false)).map(mapRemote));
    load
      .then((e) => {
        if (!current()) return;
        land();
        shownFailed.current = false;
        setEntries(e);
        setError(null);
        setRefreshError(null);
      })
      .catch((e) => {
        if (!current()) return;
        const message = describeError(e, i18n.t);
        const refreshing = shownLocation.current === location && !shownFailed.current;
        land();
        if (refreshing) {
          setRefreshError(message);
          return;
        }
        shownFailed.current = true;
        setError({ message, code: backendErrorCode(e) });
      });
  }, [isLocal, sftpId, cwd, reloadKey]);

  useEffect(() => () => { wantedLocation.current = null; }, []);

  return { entries, loading, error: error?.message ?? null, errorCode: error?.code ?? null, refreshError };
}
