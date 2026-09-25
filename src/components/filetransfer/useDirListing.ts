import { useEffect, useRef, useState } from "react";
import { sftpListDir, fsListDir, type LocalFile } from "@/services/sftp";
import { type FileEntry, mapRemote } from "./SFTPTypes";

/** Listing of `cwd`, re-read whenever `reloadKey` changes. Only the newest
 *  request lands: a slow listing of a directory the user already left would
 *  otherwise replace the current one, and actions would then target files that
 *  are not where the pane says. `loading`/`error` belong to the first listing
 *  after a location change; background reloads keep the old entries on failure. */
export function useDirListing(isLocal: boolean, sftpId: string | null, cwd: string, reloadKey: unknown) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownLocation = useRef<string | null>(null);

  useEffect(() => {
    const location = `${isLocal}\n${sftpId}\n${cwd}`;
    const isPrimaryLoad = shownLocation.current !== location;
    if (isPrimaryLoad) { setLoading(true); setError(null); }

    let cancelled = false;
    const load = isLocal
      ? fsListDir(cwd).then((files) =>
          files.map<FileEntry>((f: LocalFile) => ({ name: f.name, path: f.path, size: f.size, isDir: f.is_dir, modified: f.modified ?? undefined })))
      : sftpListDir(sftpId!, cwd).then((files) => files.map(mapRemote));
    load
      .then((e) => {
        if (cancelled) return;
        shownLocation.current = location;
        setEntries(e);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled || !isPrimaryLoad) return;
        shownLocation.current = location;
        setError(String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isLocal, sftpId, cwd, reloadKey]);

  return { entries, loading, error };
}
