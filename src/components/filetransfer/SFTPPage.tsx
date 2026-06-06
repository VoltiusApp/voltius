import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";
import {
  sftpConnect, sftpClose,
  sftpUpload, sftpDownload, sftpUploadDir, sftpDownloadDir,
  sftpUploadDirTar, sftpDownloadDirTar, sftpTransferDirTar,
  sftpUploadBatchTar, sftpDownloadBatchTar, sftpTransferBatchTar,
  sftpTransfer, sftpTransferDir,
  sftpExists, fsExists, fsHomeDir, fsCopy, wslHomeDir,
  pickLocalPath, pickLocalPaths,
} from "@/services/sftp";
import { hitTestDropTarget, setExternalDragHover, clearExternalDragHover } from "./internalDrag";
import { triggerUpload } from "./osDropPipeline";
import { useToggle } from "@/stores/toggleSettingsStore";
import { useTransferQueueStore } from "@/stores/transferQueueStore";
import { resolveConnectionCredentials, resolveJumpHosts } from "@/services/credentials";
import {
  type HostChoice, type SidePhase, type FileEntry,
  genId,
} from "./SFTPTypes";
import { SidePane } from "./SidePane";
import { ConflictDialog } from "./ConflictDialog";
import { InternalDragGhost } from "./InternalDragGhost";
import { triggerOsDrop as triggerOsDropPipeline } from "./osDropPipeline";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useConnectionStore } from "@/stores/connectionStore";

export default function SFTPPage() {
  const [tarTransferEnabled] = useToggle("sftp-tar");
  const sftpPanelOpen = useUIStore((s) => s.sftpPanelOpen);
  const pendingSftpConnectionId = useUIStore((s) => s.pendingSftpConnectionId);
  const clearPendingSftpConnection = useUIStore((s) => s.clearPendingSftpConnection);
  const runTransfer = useTransferQueueStore((s) => s.runTransfer);
  const pending = useTransferQueueStore((s) => s.pending);
  const setPending = useTransferQueueStore((s) => s.setPending);
  const resolvePending = useTransferQueueStore((s) => s.resolvePending);

  const [leftHost, setLeftHost] = useState<HostChoice | null>(null);
  const [leftPhase, setLeftPhase] = useState<SidePhase>({ tag: "picking" });
  const [leftRefresh, setLeftRefresh] = useState(0);

  const [rightHost, setRightHost] = useState<HostChoice | null>(null);
  const [rightPhase, setRightPhase] = useState<SidePhase>({ tag: "picking" });
  const [rightRefresh, setRightRefresh] = useState(0);

  const openSftpIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      openSftpIds.current.forEach((id) => sftpClose(id).catch(() => {}));
    };
  }, []);

  // ── Connect / disconnect ───────────────────────────────────────────────────

  const connectSide = useCallback(async (host: HostChoice, setPhase: React.Dispatch<React.SetStateAction<SidePhase>>) => {
    const connectId = genId();
    setPhase({ tag: "connecting", connectId, host });
    try {
      let sftpId: string | null = null;
      let cwd = "/";
      if (host.kind === "local") {
        cwd = host.wslDistro ? await wslHomeDir(host.wslDistro) : await fsHomeDir();
      } else {
        const [creds, jumpHosts] = await Promise.all([
          resolveConnectionCredentials(host.connection),
          resolveJumpHosts(host.connection),
        ]);
        sftpId = await sftpConnect({ connectId, host: host.connection.host, port: host.connection.port, username: creds.username, password: creds.password, privateKey: creds.privateKey, passphrase: creds.passphrase, jumpHosts: jumpHosts.length > 0 ? jumpHosts : undefined });
        openSftpIds.current.add(sftpId);
        const { sftpCanonicalize } = await import("@/services/sftp");
        cwd = await sftpCanonicalize(sftpId, ".");
      }
      setPhase({ tag: "connected", sftpId, cwd, selected: [] });
    } catch (e) {
      setPhase({ tag: "error", message: String(e), host });
    }
  }, []);

  useEffect(() => {
    if (!sftpPanelOpen || !pendingSftpConnectionId) return;
    const { connections, teamConnections } = useConnectionStore.getState();
    const conn = [...connections, ...Object.values(teamConnections).flat()].find((c) => c.id === pendingSftpConnectionId);
    if (!conn) return;
    clearPendingSftpConnection();
    const host: HostChoice = { kind: "remote", connection: conn };
    setLeftHost(host);
    connectSide(host, setLeftPhase);
  }, [sftpPanelOpen, pendingSftpConnectionId, clearPendingSftpConnection, connectSide]);

  const disconnectSide = useCallback((setPhase: React.Dispatch<React.SetStateAction<SidePhase>>, currentPhase: SidePhase) => {
    if (currentPhase.tag === "connected" && currentPhase.sftpId) {
      openSftpIds.current.delete(currentPhase.sftpId);
      sftpClose(currentPhase.sftpId).catch(() => {});
    }
    setPhase({ tag: "picking" });
  }, []);

  // ── Auto-reconnect on error ────────────────────────────────────────────────

  useEffect(() => {
    if (leftPhase.tag === "error" && leftPhase.host) {
      const host = leftPhase.host;
      const t = setTimeout(() => connectSide(host, setLeftPhase), 1500);
      return () => clearTimeout(t);
    }
  }, [leftPhase, connectSide]);

  useEffect(() => {
    if (rightPhase.tag === "error" && rightPhase.host) {
      const host = rightPhase.host;
      const t = setTimeout(() => connectSide(host, setRightPhase), 1500);
      return () => clearTimeout(t);
    }
  }, [rightPhase, connectSide]);

  // ── Detect remote connection loss via Rust sftp-closed event ──────────────

  useEffect(() => {
    if (leftPhase.tag !== "connected" || !leftPhase.sftpId) return;
    const sftpId = leftPhase.sftpId;
    const unlisten = listen(`sftp-closed-${sftpId}`, () => {
      setLeftPhase((p) => p.tag === "connected" && p.sftpId === sftpId
        ? { tag: "error", message: "Connection lost", host: leftHost ?? undefined }
        : p);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [leftPhase.tag === "connected" ? leftPhase.sftpId : null, leftHost]);

  useEffect(() => {
    if (rightPhase.tag !== "connected" || !rightPhase.sftpId) return;
    const sftpId = rightPhase.sftpId;
    const unlisten = listen(`sftp-closed-${sftpId}`, () => {
      setRightPhase((p) => p.tag === "connected" && p.sftpId === sftpId
        ? { tag: "error", message: "Connection lost", host: rightHost ?? undefined }
        : p);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [rightPhase.tag === "connected" ? rightPhase.sftpId : null, rightHost]);

  // ── Transfers ──────────────────────────────────────────────────────────────

  const execTransfer = useCallback(async (file: FileEntry, fromSide: "left" | "right", targetFolder?: string) => {
    const src     = fromSide === "left" ? leftPhase  : rightPhase;
    const dst     = fromSide === "left" ? rightPhase : leftPhase;
    const srcHost = fromSide === "left" ? leftHost   : rightHost;
    const dstHost = fromSide === "left" ? rightHost  : leftHost;
    const dir: "→" | "←" = fromSide === "left" ? "→" : "←";
    const refreshDst = fromSide === "left" ? () => setRightRefresh((n) => n + 1) : () => setLeftRefresh((n) => n + 1);

    if (src.tag !== "connected" || dst.tag !== "connected") return;

    const dstBase  = targetFolder ?? dst.cwd;
    const destPath = `${dstBase.replace(/\/$/, "")}/${file.name}`;
    const srcIsLocal = srcHost?.kind === "local";
    const dstIsLocal = dstHost?.kind === "local";

    if (srcIsLocal && dstIsLocal) {
      await runTransfer(file.name, dir, (tid) => fsCopy(file.path, destPath, tid), refreshDst);
    } else if (srcIsLocal && !dstIsLocal && dst.sftpId) {
      await runTransfer(file.name, dir, (tid) => file.isDir
        ? (tarTransferEnabled
            ? sftpUploadDirTar({ sftpId: dst.sftpId!, localPath: file.path, remotePath: destPath, transferId: tid })
            : sftpUploadDir({ sftpId: dst.sftpId!, localPath: file.path, remotePath: destPath, transferId: tid }))
        : sftpUpload({ sftpId: dst.sftpId!, localPath: file.path, remotePath: destPath, transferId: tid }), refreshDst);
    } else if (!srcIsLocal && dstIsLocal && src.sftpId) {
      await runTransfer(file.name, dir, (tid) => file.isDir
        ? (tarTransferEnabled
            ? sftpDownloadDirTar({ sftpId: src.sftpId!, remotePath: file.path, localPath: destPath, transferId: tid })
            : sftpDownloadDir({ sftpId: src.sftpId!, remotePath: file.path, localPath: destPath, transferId: tid }))
        : sftpDownload({ sftpId: src.sftpId!, remotePath: file.path, localPath: destPath, transferId: tid }), refreshDst);
    } else if (!srcIsLocal && !dstIsLocal && src.sftpId && dst.sftpId) {
      await runTransfer(file.name, dir, (tid) => file.isDir
        ? (tarTransferEnabled
            ? sftpTransferDirTar({ srcSftpId: src.sftpId!, srcPath: file.path, dstSftpId: dst.sftpId!, dstPath: destPath, transferId: tid })
            : sftpTransferDir({ srcSftpId: src.sftpId!, srcPath: file.path, dstSftpId: dst.sftpId!, dstPath: destPath, transferId: tid }))
        : sftpTransfer({ srcSftpId: src.sftpId!, srcPath: file.path, dstSftpId: dst.sftpId!, dstPath: destPath, transferId: tid }), refreshDst);
    }
  }, [leftPhase, rightPhase, leftHost, rightHost, runTransfer, tarTransferEnabled]);

  // Batch-tar path: packs all selected items into one archive per transfer.
  const execBatchTar = useCallback(async (files: FileEntry[], fromSide: "left" | "right", targetFolder?: string) => {
    const src     = fromSide === "left" ? leftPhase  : rightPhase;
    const dst     = fromSide === "left" ? rightPhase : leftPhase;
    const srcHost = fromSide === "left" ? leftHost   : rightHost;
    const dstHost = fromSide === "left" ? rightHost  : leftHost;
    const dir: "→" | "←" = fromSide === "left" ? "→" : "←";
    const refreshDst = fromSide === "left" ? () => setRightRefresh((n) => n + 1) : () => setLeftRefresh((n) => n + 1);

    if (src.tag !== "connected" || dst.tag !== "connected") return;

    const dstBase    = targetFolder ?? dst.cwd;
    const srcIsLocal = srcHost?.kind === "local";
    const dstIsLocal = dstHost?.kind === "local";
    const label      = files.length === 1 ? files[0].name : `${files.length} items`;

    if (srcIsLocal && dstIsLocal) {
      for (const file of files) {
        const destPath = `${dstBase.replace(/\/$/, "")}/${file.name}`;
        await runTransfer(file.name, dir, (tid) => fsCopy(file.path, destPath, tid), refreshDst);
      }
    } else if (srcIsLocal && !dstIsLocal && dst.sftpId) {
      await runTransfer(label, dir, (tid) =>
        sftpUploadBatchTar({ sftpId: dst.sftpId!, localPaths: files.map((f) => f.path), remoteDir: dstBase, transferId: tid }), refreshDst);
    } else if (!srcIsLocal && dstIsLocal && src.sftpId) {
      await runTransfer(label, dir, (tid) =>
        sftpDownloadBatchTar({ sftpId: src.sftpId!, remotePaths: files.map((f) => f.path), localDir: dstBase, transferId: tid }), refreshDst);
    } else if (!srcIsLocal && !dstIsLocal && src.sftpId && dst.sftpId) {
      await runTransfer(label, dir, (tid) =>
        sftpTransferBatchTar({ srcSftpId: src.sftpId!, srcPaths: files.map((f) => f.path), dstSftpId: dst.sftpId!, dstDir: dstBase, transferId: tid }), refreshDst);
    }
  }, [leftPhase, rightPhase, leftHost, rightHost, runTransfer]);

  // Dispatch: batch-tar for multiple items when enabled, otherwise per-file.
  const executeFiles = useCallback((files: FileEntry[], fromSide: "left" | "right", targetFolder?: string) => {
    if (tarTransferEnabled && files.length > 1) {
      void execBatchTar(files, fromSide, targetFolder);
    } else {
      for (const file of files) void execTransfer(file, fromSide, targetFolder);
    }
  }, [tarTransferEnabled, execBatchTar, execTransfer]);

  const triggerTransfer = useCallback(async (files: FileEntry[], fromSide: "left" | "right", targetFolder?: string) => {
    const dst     = fromSide === "left" ? rightPhase : leftPhase;
    const dstHost = fromSide === "left" ? rightHost  : leftHost;
    if (dst.tag !== "connected") return;

    const dstIsLocal = dstHost?.kind === "local";
    const dstBase    = targetFolder ?? dst.cwd;

    const conflicts = (
      await Promise.all(files.map(async (f) => {
        const dstPath = `${dstBase.replace(/\/$/, "")}/${f.name}`;
        const exists = dstIsLocal ? await fsExists(dstPath) : await sftpExists(dst.sftpId!, dstPath);
        return exists ? f : null;
      }))
    ).filter((f): f is FileEntry => f !== null);

    const conflictPaths = new Set(conflicts.map((f) => f.path));
    const toTransfer = files.filter((f) => !conflictPaths.has(f.path));

    if (conflicts.length > 0) {
      setPending({
        conflicts,
        toTransfer,
        totalConflicts: conflicts.length,
        execute: (files) => executeFiles(files, fromSide, targetFolder),
      });
      return;
    }

    executeFiles(files, fromSide, targetFolder);
  }, [leftPhase, rightPhase, leftHost, rightHost, executeFiles, setPending]);

  const transfer = useCallback((direction: "LR" | "RL") => {
    const fromSide = direction === "LR" ? "left" : "right" as const;
    const srcPhase = direction === "LR" ? leftPhase : rightPhase;
    if (srcPhase.tag !== "connected" || srcPhase.selected.length === 0) return;
    void triggerTransfer(srcPhase.selected, fromSide);
  }, [leftPhase, rightPhase, triggerTransfer]);

  // ── OS-originated drops (files dragged from Finder / Explorer) ────────────

  const triggerOsDrop = useCallback(async (paths: string[], dstSide: "left" | "right", targetFolder?: string) => {
    const dst     = dstSide === "left" ? leftPhase  : rightPhase;
    const dstHost = dstSide === "left" ? leftHost   : rightHost;
    const refreshDst = dstSide === "left" ? () => setLeftRefresh((n) => n + 1) : () => setRightRefresh((n) => n + 1);
    if (dst.tag !== "connected") return;

    await triggerOsDropPipeline(paths, {
      isLocal: dstHost?.kind === "local",
      sftpId: dst.sftpId,
      cwd: targetFolder ?? dst.cwd,
      onRefresh: refreshDst,
    });
  }, [leftPhase, rightPhase, leftHost, rightHost]);

  // Tauri's drag-drop event delivers OS file paths once the user releases over
  // the webview. Position is in physical pixels; elementFromPoint wants CSS
  // pixels, so we scale by devicePixelRatio for hit-testing.
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const p = event.payload;
        const dpr = window.devicePixelRatio || 1;
        if (p.type === "enter" || p.type === "over") {
          const { x, y } = p.position;
          const hit = hitTestDropTarget(x / dpr, y / dpr, null);
          if (hit.side === "left" || hit.side === "right") {
            setExternalDragHover(hit.side, hit.folder);
          }
        } else if (p.type === "drop") {
          clearExternalDragHover();
          const { x, y } = p.position;
          const hit = hitTestDropTarget(x / dpr, y / dpr, null);
          if ((hit.side === "left" || hit.side === "right") && p.paths.length > 0) {
            void triggerOsDrop(p.paths, hit.side, hit.folder ?? undefined);
          }
        } else {
          clearExternalDragHover();
        }
      });
      if (cancelled) unlisten();
      else unlistenFn = unlisten;
    })();
    return () => { cancelled = true; unlistenFn?.(); };
  }, [triggerOsDrop]);

  // ── Local-disk upload / download (independent of the cross-pane transfer) ──
  // Mirrors the SFTP right-panel: "Upload" picks local files into this pane's
  // cwd, "Download" pulls the selected remote files to a chosen local folder.

  const uploadToSide = useCallback(async (side: "left" | "right") => {
    const phase = side === "left" ? leftPhase : rightPhase;
    const host  = side === "left" ? leftHost  : rightHost;
    if (phase.tag !== "connected") return;
    const paths = await pickLocalPaths({ title: "Select files to upload" });
    if (paths.length === 0) return;
    const items: FileEntry[] = [];
    for (const path of paths) {
      try {
        const isDir = await invoke<boolean | null>("fs_stat", { path });
        if (isDir === null) continue;
        const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
        items.push({ name, path, size: 0, isDir });
      } catch { /* skip */ }
    }
    const refresh = side === "left" ? () => setLeftRefresh((n) => n + 1) : () => setRightRefresh((n) => n + 1);
    await triggerUpload(items, { isLocal: host?.kind === "local", sftpId: phase.sftpId, cwd: phase.cwd, onRefresh: refresh });
  }, [leftPhase, rightPhase, leftHost, rightHost]);

  const downloadFromSide = useCallback(async (side: "left" | "right", files: FileEntry[]) => {
    const phase = side === "left" ? leftPhase : rightPhase;
    const host  = side === "left" ? leftHost  : rightHost;
    if (phase.tag !== "connected" || host?.kind === "local" || !phase.sftpId || files.length === 0) return;
    const dstDir = await pickLocalPath({ directory: true, title: "Download to folder" });
    if (!dstDir) return;
    const sftpId = phase.sftpId;
    const base = dstDir.replace(/[\\/]$/, "");
    const label = files.length === 1 ? files[0].name : `${files.length} items`;

    if (tarTransferEnabled && files.length > 1) {
      await runTransfer(label, "←", (tid) =>
        sftpDownloadBatchTar({ sftpId, remotePaths: files.map((f) => f.path), localDir: base, transferId: tid }));
      return;
    }

    for (const file of files) {
      const sep = /\\/.test(base) ? "\\" : "/";
      const localPath = `${base}${sep}${file.name}`;
      await runTransfer(file.name, "←", (tid) => file.isDir
        ? (tarTransferEnabled
            ? sftpDownloadDirTar({ sftpId, remotePath: file.path, localPath, transferId: tid })
            : sftpDownloadDir({ sftpId, remotePath: file.path, localPath, transferId: tid }))
        : sftpDownload({ sftpId, remotePath: file.path, localPath, transferId: tid }));
    }
  }, [leftPhase, rightPhase, leftHost, rightHost, runTransfer, tarTransferEnabled]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const { connectLocalAt, connectAt } = useSessionStore();

  const makeOpenInTerminal = useCallback((host: HostChoice | null) => (path: string) => {
    if (!host) return;
    if (host.kind === "local") {
      connectLocalAt(path).catch(() => {});
    } else {
      connectAt(host.connection.id, path).catch(() => {});
    }
  }, [connectLocalAt, connectAt]);

  const leftSelected  = leftPhase.tag  === "connected" ? leftPhase.selected  : [];
  const rightSelected = rightPhase.tag === "connected" ? rightPhase.selected : [];
  const canTransferLR = leftSelected.length  > 0 && rightPhase.tag === "connected";
  const canTransferRL = rightSelected.length > 0 && leftPhase.tag  === "connected";
  const transferLRTitle = canTransferLR ? (leftSelected.length  === 1 ? `Transfer "${leftSelected[0].name}" →`  : `Transfer ${leftSelected.length} items →`)  : "Select a file on the left";
  const transferRLTitle = canTransferRL ? (rightSelected.length === 1 ? `Transfer "${rightSelected[0].name}" ←` : `Transfer ${rightSelected.length} items ←`) : "Select a file on the right";

  return (
    <div className="flex flex-col h-full bg-[var(--t-bg-base)]">
      <div className="flex flex-1 min-h-0 gap-3 p-3">
        <div className="flex-1 min-w-0 rounded-xl overflow-hidden border border-[var(--t-border)]">
          <SidePane
            host={leftHost} phase={leftPhase} refreshTick={leftRefresh}
            onPick={(h) => { setLeftHost(h); connectSide(h, setLeftPhase); }}
            onNavigate={(p) => setLeftPhase((prev) => prev.tag === "connected" ? { ...prev, cwd: p, selected: [] } : prev)}
            onSelect={(files) => setLeftPhase((prev) => prev.tag === "connected" ? { ...prev, selected: files } : prev)}
            onRefresh={() => setLeftRefresh((n) => n + 1)}
            onChangeHost={() => { disconnectSide(setLeftPhase, leftPhase); setLeftHost(null); }}
            side="left"
            onDropFiles={(files, fromSide, targetFolder) => { if (fromSide !== "panel") void triggerTransfer(files, fromSide, targetFolder); }}
            onTransferToTarget={(files) => void triggerTransfer(files, "left")}
            canTransferToTarget={rightPhase.tag === "connected"}
            onOpenInTerminal={makeOpenInTerminal(leftHost)}
            selected={leftSelected}
            onUpload={() => void uploadToSide("left")}
            onDownloadFiles={leftHost?.kind === "local" ? undefined : (files) => void downloadFromSide("left", files)}
          />
        </div>

        <div className="flex flex-col items-center justify-center shrink-0 w-10">
          <div className="flex flex-col gap-1.5 p-1.5 rounded-xl border border-[var(--t-border)] bg-[var(--t-bg-elevated)]">
            <TransferBtn icon="lucide:arrow-right" title={transferLRTitle} disabled={!canTransferLR} onClick={() => transfer("LR")} />
            <TransferBtn icon="lucide:arrow-left"  title={transferRLTitle} disabled={!canTransferRL} onClick={() => transfer("RL")} />
          </div>
        </div>

        <div className="flex-1 min-w-0 rounded-xl overflow-hidden border border-[var(--t-border)]">
          <SidePane
            host={rightHost} phase={rightPhase} refreshTick={rightRefresh}
            onPick={(h) => { setRightHost(h); connectSide(h, setRightPhase); }}
            onNavigate={(p) => setRightPhase((prev) => prev.tag === "connected" ? { ...prev, cwd: p, selected: [] } : prev)}
            onSelect={(files) => setRightPhase((prev) => prev.tag === "connected" ? { ...prev, selected: files } : prev)}
            onRefresh={() => setRightRefresh((n) => n + 1)}
            onChangeHost={() => { disconnectSide(setRightPhase, rightPhase); setRightHost(null); }}
            side="right"
            onDropFiles={(files, fromSide, targetFolder) => { if (fromSide !== "panel") void triggerTransfer(files, fromSide, targetFolder); }}
            onTransferToTarget={(files) => void triggerTransfer(files, "right")}
            canTransferToTarget={leftPhase.tag === "connected"}
            onOpenInTerminal={makeOpenInTerminal(rightHost)}
            selected={rightSelected}
            onUpload={() => void uploadToSide("right")}
            onDownloadFiles={rightHost?.kind === "local" ? undefined : (files) => void downloadFromSide("right", files)}
          />
        </div>
      </div>

      {pending && (
        <ConflictDialog
          conflict={pending.conflicts[0]}
          conflictNumber={pending.totalConflicts - pending.conflicts.length + 1}
          totalConflicts={pending.totalConflicts}
          onResolve={resolvePending}
        />
      )}

      <InternalDragGhost />
    </div>
  );
}

function TransferBtn({ icon, title, disabled, onClick }: { icon: string; title: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center justify-center w-6 h-6 rounded-md transition-all"
      style={{
        background: disabled ? "transparent" : "var(--t-bg-elevated)",
        border: `1px solid ${disabled ? "var(--t-border)" : "var(--t-border-hover)"}`,
        color: disabled ? "var(--t-text-dim)" : "var(--t-accent)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "var(--t-bg-card-hover)"; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = "var(--t-bg-elevated)"; }}
    >
      <Icon icon={icon} width={12} />
    </button>
  );
}
