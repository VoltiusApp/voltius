import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import i18n from "@/i18n";
import {
  sftpClose, sftpCanonicalize,
  sftpMkdir, sftpRename, sftpDelete, sftpTouch,
} from "@/services/sftp";
import { connectFileBackend } from "@/services/sftpTarget";
import { connectDevice } from "@/services/deviceFiles";
import { useReadOnlyFlips } from "@/services/deviceReadOnly";
import type { MyDevice } from "@/services/myDevices";
import { useConnectionStore } from "@/stores/connectionStore";
import { type FileEntry, genId } from "@/components/filetransfer/SFTPTypes";
import { useDirListing } from "@/components/filetransfer/useDirListing";
import { joinPath } from "@/components/filetransfer/moveTargetCore";
import { closedPhase, connectErrorPhase, useConnectRetry } from "@/hooks/useConnectRetry";
import type { Connection } from "@/types";
import type { BackendErrorCode } from "@/services/backendErrors";

export type SftpPhase =
  | { tag: "connecting" }
  | { tag: "connected"; sftpId: string; readOnly?: boolean }
  | { tag: "error"; message: string; errorCode?: BackendErrorCode; final?: boolean };

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

export type SftpDirTarget = Connection | { device: MyDevice };

const targetKey = (t: SftpDirTarget | undefined) => (!t ? undefined : "device" in t ? t.device.deviceId : t.id);

/** Standalone remote SFTP browser for one Connection: own SSH/SFTP connection, cwd nav,
 *  dir listing, file ops. Remote-only (no local FS). Transfers NOT handled here. */
export function useSftpDir(target: SftpDirTarget | undefined) {
  const key = targetKey(target);
  const [phase, setPhase] = useState<SftpPhase>({ tag: "connecting" });
  const [cwd, setCwd] = useState<string>("/");
  const [refreshTick, setRefreshTick] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  const sftpIdRef = useRef<string | null>(null);
  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  // Connect once per connection.
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setPhase({ tag: "connecting" });
    (async () => {
      try {
        let sftpId: string;
        let readOnly: boolean | undefined;
        if ("device" in target) {
          ({ sftpId, readOnly } = await connectDevice(target.device.deviceId, genId()));
        } else {
          sftpId = await connectFileBackend(target, genId());
          useConnectionStore.getState().setLastUsed(target.id).catch(() => {});
        }
        if (cancelled) { sftpClose(sftpId).catch(() => {}); return; }
        sftpIdRef.current = sftpId;
        const home = await sftpCanonicalize(sftpId, ".");
        if (cancelled) { sftpClose(sftpId).catch(() => {}); return; }
        setCwd(home || "/");
        setPhase({ tag: "connected", sftpId, readOnly });
      } catch (e) {
        if (!cancelled) setPhase(connectErrorPhase(e));
      }
    })();
    return () => {
      cancelled = true;
      if (sftpIdRef.current) { sftpClose(sftpIdRef.current).catch(() => {}); sftpIdRef.current = null; }
    };
  }, [key, retryTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-reconnect on error. Mobile backgrounding (e.g. SAF picker) freezes the
  // process and trips keepalive; retry so the drop self-heals instead of dead-ending.
  const { retrying, reset: resetRetry } = useConnectRetry(phase, () => setRetryTick((n) => n + 1), key);
  const reconnect = useCallback(() => { resetRetry(); setRetryTick((n) => n + 1); }, [resetRetry]);

  // Detect connection loss.
  useEffect(() => {
    if (phase.tag !== "connected") return;
    const id = phase.sftpId;
    const un = listen<{ code?: BackendErrorCode } | null>(`sftp-closed-${id}`, ({ payload }) => {
      const lost = i18n.t("fileTransfer.page.connectionLost");
      const next: SftpPhase = closedPhase(payload, lost);
      setPhase((p) => (p.tag === "connected" && p.sftpId === id ? next : p));
    });
    return () => { un.then((fn) => fn()); };
  }, [phase]);

  const sftpId = phase.tag === "connected" ? phase.sftpId : null;
  const applyReadOnly = useCallback((readOnly: boolean) => {
    setPhase((p) => (p.tag === "connected" && p.sftpId === sftpId ? { ...p, readOnly } : p));
  }, [sftpId]);
  useReadOnlyFlips(sftpId, applyReadOnly);
  const { entries, loading: listing, landedCwd, error: listError, errorCode: listErrorCode } = useDirListing(false, sftpId, cwd, refreshTick);
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

  const readOnly = phase.tag === "connected" && !!phase.readOnly;
  return { phase, retrying, readOnly, sftpId, cwd, entries, listing, landedCwd, listError, listErrorCode, navigate, goUp, refresh, reconnect, mkdir, touch, rename, remove };
}
