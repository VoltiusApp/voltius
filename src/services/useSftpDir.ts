import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  sftpConnect, sftpClose, sftpCanonicalize, sftpListDir,
  sftpMkdir, sftpRename, sftpDelete, sftpTouch,
  type RemoteFile,
} from "@/services/sftp";
import { resolveConnectionCredentials, resolveJumpHosts } from "@/services/credentials";
import { resolveKeepalive } from "@/utils/keepalive";
import { getGlobalKeepalivePreset } from "@/stores/connectivitySettingsStore";
import { type FileEntry, genId } from "@/components/filetransfer/SFTPTypes";
import type { Connection } from "@/types";

export type SftpPhase =
  | { tag: "connecting" }
  | { tag: "connected"; sftpId: string }
  | { tag: "error"; message: string };

/** Parent of a POSIX path; "/" stays "/". */
export function parentDir(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  return "/" + parts.slice(0, -1).join("/");
}

/** Breadcrumb segments for a POSIX path: [{ name, path }], rooted at "/". */
export function breadcrumbs(path: string): { name: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  const out = [{ name: "/", path: "/" }];
  let acc = "";
  for (const p of parts) { acc += "/" + p; out.push({ name: p, path: acc }); }
  return out;
}

function mapRemote(f: RemoteFile): FileEntry {
  return {
    name: f.name,
    path: f.path,
    size: f.size,
    isDir: f.is_dir,
    modified: f.modified ?? undefined,
    permissions: f.permissions ?? undefined,
    isSymlink: f.is_symlink,
  };
}

/** Standalone remote SFTP browser for one Connection: own SSH/SFTP connection, cwd nav,
 *  dir listing, file ops. Remote-only (no local FS). Transfers NOT handled here. */
export function useSftpDir(connection: Connection | undefined) {
  const [phase, setPhase] = useState<SftpPhase>({ tag: "connecting" });
  const [cwd, setCwd] = useState<string>("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  const sftpIdRef = useRef<string | null>(null);
  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);
  const reconnect = useCallback(() => setRetryTick((n) => n + 1), []);

  // Connect once per connection.
  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    setPhase({ tag: "connecting" });
    (async () => {
      try {
        const connectId = genId();
        const [creds, jumpHosts] = await Promise.all([
          resolveConnectionCredentials(connection),
          resolveJumpHosts(connection),
        ]);
        const ka = resolveKeepalive(connection.keepalive_preset ?? getGlobalKeepalivePreset());
        const sftpId = await sftpConnect({
          connectId,
          host: connection.host,
          port: connection.port,
          username: creds.username,
          password: creds.password,
          privateKey: creds.privateKey,
          passphrase: creds.passphrase,
          jumpHosts: jumpHosts.length > 0 ? jumpHosts : undefined,
          keepaliveIntervalSecs: ka.intervalSecs,
          keepaliveMax: ka.max,
        });
        if (cancelled) { sftpClose(sftpId).catch(() => {}); return; }
        sftpIdRef.current = sftpId;
        const home = await sftpCanonicalize(sftpId, ".");
        if (cancelled) { sftpClose(sftpId).catch(() => {}); return; }
        setCwd(home || "/");
        setPhase({ tag: "connected", sftpId });
      } catch (e) {
        if (!cancelled) setPhase({ tag: "error", message: String(e) });
      }
    })();
    return () => {
      cancelled = true;
      if (sftpIdRef.current) { sftpClose(sftpIdRef.current).catch(() => {}); sftpIdRef.current = null; }
    };
  }, [connection?.id, retryTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-reconnect on error. Mobile backgrounding (e.g. SAF picker) freezes the
  // process and trips keepalive; retry so the drop self-heals instead of dead-ending.
  useEffect(() => {
    if (phase.tag !== "error") return;
    const t = setTimeout(() => setRetryTick((n) => n + 1), 2000);
    return () => clearTimeout(t);
  }, [phase]);

  // Detect connection loss.
  useEffect(() => {
    if (phase.tag !== "connected") return;
    const id = phase.sftpId;
    const un = listen(`sftp-closed-${id}`, () =>
      setPhase((p) => (p.tag === "connected" && p.sftpId === id ? { tag: "error", message: "Connection lost" } : p)));
    return () => { un.then((fn) => fn()); };
  }, [phase]);

  // List on cwd / refresh change.
  useEffect(() => {
    if (phase.tag !== "connected") return;
    let cancelled = false;
    setListing(true); setListError(null);
    sftpListDir(phase.sftpId, cwd)
      .then((files) => { if (!cancelled) { setEntries(files.map(mapRemote)); setListing(false); } })
      .catch((e) => { if (!cancelled) { setListError(String(e)); setListing(false); } });
    return () => { cancelled = true; };
  }, [phase, cwd, refreshTick]);

  const sftpId = phase.tag === "connected" ? phase.sftpId : null;
  const navigate = useCallback((p: string) => { setCwd(p); }, []);
  const goUp = useCallback(() => setCwd((c) => parentDir(c)), []);
  const mkdir = useCallback(async (name: string) => {
    if (sftpId) { await sftpMkdir(sftpId, `${cwd.replace(/\/$/, "")}/${name}`); refresh(); }
  }, [sftpId, cwd, refresh]);
  const touch = useCallback(async (name: string) => {
    if (sftpId) { await sftpTouch(sftpId, `${cwd.replace(/\/$/, "")}/${name}`); refresh(); }
  }, [sftpId, cwd, refresh]);
  const rename = useCallback(async (f: FileEntry, newName: string) => {
    if (!sftpId) return;
    const dir = f.path.slice(0, f.path.lastIndexOf("/"));
    await sftpRename(sftpId, f.path, `${dir}/${newName}`); refresh();
  }, [sftpId, refresh]);
  const remove = useCallback(async (f: FileEntry) => {
    if (sftpId) { await sftpDelete(sftpId, f.path); refresh(); }
  }, [sftpId, refresh]);

  return { phase, sftpId, cwd, entries, listing, listError, navigate, goUp, refresh, reconnect, mkdir, touch, rename, remove };
}
