import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import i18n from "@/i18n";
import {
  ftpConnect, sftpClose, sftpCanonicalize,
  sftpMkdir, sftpRename, sftpDelete, sftpTouch,
} from "@/services/sftp";
import { resolveConnectionCredentials } from "@/services/credentials";
import { sftpConnectToConnection } from "@/services/sftpTarget";
import { type FileEntry, genId } from "@/components/filetransfer/SFTPTypes";
import { useDirListing } from "@/components/filetransfer/useDirListing";
import { joinPath } from "@/components/filetransfer/moveTargetCore";
import { useConnectRetry } from "@/hooks/useConnectRetry";
import type { Connection } from "@/types";
import { backendErrorCode, describeError, type BackendErrorCode } from "@/services/backendErrors";

export type SftpPhase =
  | { tag: "connecting" }
  | { tag: "connected"; sftpId: string }
  | { tag: "error"; message: string; errorCode?: BackendErrorCode };

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

/** Standalone remote SFTP browser for one Connection: own SSH/SFTP connection, cwd nav,
 *  dir listing, file ops. Remote-only (no local FS). Transfers NOT handled here. */
export function useSftpDir(connection: Connection | undefined) {
  const [phase, setPhase] = useState<SftpPhase>({ tag: "connecting" });
  const [cwd, setCwd] = useState<string>("/");
  const [refreshTick, setRefreshTick] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  const sftpIdRef = useRef<string | null>(null);
  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  // Connect once per connection.
  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    setPhase({ tag: "connecting" });
    (async () => {
      try {
        const connectId = genId();
        let sftpId: string;
        if (connection.connection_type === "ftp") {
          const creds = await resolveConnectionCredentials(connection);
          sftpId = await ftpConnect({
            host: connection.host,
            port: connection.port,
            username: creds.username,
            password: creds.password,
            secure: !!connection.ftp_secure,
          });
        } else {
          sftpId = await sftpConnectToConnection(connection, connectId);
        }
        if (cancelled) { sftpClose(sftpId).catch(() => {}); return; }
        sftpIdRef.current = sftpId;
        const home = await sftpCanonicalize(sftpId, ".");
        if (cancelled) { sftpClose(sftpId).catch(() => {}); return; }
        setCwd(home || "/");
        setPhase({ tag: "connected", sftpId });
      } catch (e) {
        if (!cancelled) setPhase({ tag: "error", message: describeError(e, i18n.t), errorCode: backendErrorCode(e) ?? undefined });
      }
    })();
    return () => {
      cancelled = true;
      if (sftpIdRef.current) { sftpClose(sftpIdRef.current).catch(() => {}); sftpIdRef.current = null; }
    };
  }, [connection?.id, retryTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-reconnect on error. Mobile backgrounding (e.g. SAF picker) freezes the
  // process and trips keepalive; retry so the drop self-heals instead of dead-ending.
  const { retrying, reset: resetRetry } = useConnectRetry(phase, () => setRetryTick((n) => n + 1), connection?.id);
  const reconnect = useCallback(() => { resetRetry(); setRetryTick((n) => n + 1); }, [resetRetry]);

  // Detect connection loss.
  useEffect(() => {
    if (phase.tag !== "connected") return;
    const id = phase.sftpId;
    const un = listen(`sftp-closed-${id}`, () =>
      setPhase((p) => (p.tag === "connected" && p.sftpId === id ? { tag: "error", message: i18n.t("fileTransfer.page.connectionLost") } : p)));
    return () => { un.then((fn) => fn()); };
  }, [phase]);

  const sftpId = phase.tag === "connected" ? phase.sftpId : null;
  const { entries, loading: listing, error: listError, errorCode: listErrorCode } = useDirListing(false, sftpId, cwd, refreshTick);
  const navigate = useCallback((p: string) => { setCwd(p); }, []);
  const goUp = useCallback(() => setCwd((c) => parentDir(c)), []);
  const mkdir = useCallback(async (name: string) => {
    if (sftpId) { await sftpMkdir(sftpId, joinPath(cwd, name)); refresh(); }
  }, [sftpId, cwd, refresh]);
  const touch = useCallback(async (name: string) => {
    if (sftpId) { await sftpTouch(sftpId, joinPath(cwd, name)); refresh(); }
  }, [sftpId, cwd, refresh]);
  const rename = useCallback(async (f: FileEntry, newName: string) => {
    if (!sftpId) return;
    await sftpRename(sftpId, f.path, joinPath(parentDir(f.path), newName)); refresh();
  }, [sftpId, refresh]);
  const remove = useCallback(async (f: FileEntry) => {
    if (sftpId) { await sftpDelete(sftpId, f.path); refresh(); }
  }, [sftpId, refresh]);

  return { phase, retrying, sftpId, cwd, entries, listing, listError, listErrorCode, navigate, goUp, refresh, reconnect, mkdir, touch, rename, remove };
}
