import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Icon } from "@iconify/react";
import {
  sftpConnect, sftpClose,
  sftpUpload, sftpDownload, sftpUploadDir, sftpDownloadDir,
  sftpUploadDirTar, sftpDownloadDirTar, sftpTransferDirTar,
  sftpUploadBatchTar, sftpDownloadBatchTar, sftpTransferBatchTar,
  sftpTransfer, sftpTransferDir,
  sftpCancelTransfer, onTransferProgress,
  sftpExists, fsExists, fsHomeDir,
} from "@/services/sftp";
import { useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { resolveConnectionCredentials, resolveJumpHosts } from "@/services/credentials";
import {
  type HostChoice, type SidePhase, type FileEntry, type Transfer, type PendingTransfer, type ConflictResolution,
  genId,
} from "./SFTPTypes";
import { SidePane } from "./SidePane";
import { ConflictDialog } from "./ConflictDialog";
import { TransferQueue } from "./TransferQueue";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useConnectionStore } from "@/stores/connectionStore";

export default function SFTPPage() {
  const tarTransferEnabled = useSftpSettingsStore((s) => s.tarTransferEnabled);
  const sftpPanelOpen = useUIStore((s) => s.sftpPanelOpen);
  const pendingSftpConnectionId = useUIStore((s) => s.pendingSftpConnectionId);
  const clearPendingSftpConnection = useUIStore((s) => s.clearPendingSftpConnection);
  const [leftHost, setLeftHost] = useState<HostChoice | null>(null);
  const [leftPhase, setLeftPhase] = useState<SidePhase>({ tag: "picking" });
  const [leftRefresh, setLeftRefresh] = useState(0);

  const [rightHost, setRightHost] = useState<HostChoice | null>(null);
  const [rightPhase, setRightPhase] = useState<SidePhase>({ tag: "picking" });
  const [rightRefresh, setRightRefresh] = useState(0);

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const unlisteners = useRef<(() => void)[]>([]);
  const openSftpIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      unlisteners.current.forEach((u) => u());
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
        cwd = await fsHomeDir();
      } else {
        const [creds, jumpHosts] = await Promise.all([
          resolveConnectionCredentials(host.connection),
          resolveJumpHosts(host.connection),
        ]);
        sftpId = await sftpConnect({ connectId, host: host.connection.host, port: host.connection.port, username: creds.username, password: creds.password, privateKey: creds.privateKey, jumpHosts: jumpHosts.length > 0 ? jumpHosts : undefined });
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

  const runTransfer = useCallback(async (label: string, direction: "→" | "←", fn: (tid: string) => Promise<void>, onDone?: () => void) => {
    const tid = genId();
    const entry: Transfer = { id: tid, label, direction, transferred: 0, total: 0, status: "running" };
    setTransfers((prev) => [entry, ...prev.slice(0, 29)]);
    const startTime = Date.now();
    const unlisten = await onTransferProgress(tid, (p) => {
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0.5 ? p.transferred / elapsed : undefined;
      const eta = speed && p.total > p.transferred ? Math.round((p.total - p.transferred) / speed) : undefined;
      setTransfers((prev) => prev.map((t) => t.id === tid ? { ...t, transferred: p.transferred, total: p.total, speed, eta } : t));
    });
    unlisteners.current.push(unlisten);
    try {
      await fn(tid);
      setTransfers((prev) => prev.map((t) => t.id === tid ? { ...t, status: "done" } : t));
      onDone?.();
    } catch (e) {
      const msg = String(e);
      const wasCancelled = msg.toLowerCase().includes("cancel");
      setTransfers((prev) =>
        prev.map((t) => {
          if (t.id !== tid) return t;
          if (t.status === "cancelled") return t;
          return wasCancelled ? { ...t, status: "cancelled" } : { ...t, status: "error", error: msg };
        }),
      );
    } finally {
      unlisten();
    }
  }, []);

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

    if (srcIsLocal && !dstIsLocal && dst.sftpId) {
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

    if (srcIsLocal && !dstIsLocal && dst.sftpId) {
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

    if (conflicts.length > 0) {
      const conflictPaths = new Set(conflicts.map((f) => f.path));
      setPendingTransfer({ fromSide, conflicts, toTransfer: files.filter((f) => !conflictPaths.has(f.path)), totalConflicts: conflicts.length, targetFolder });
      return;
    }

    executeFiles(files, fromSide, targetFolder);
  }, [leftPhase, rightPhase, leftHost, rightHost, executeFiles]);

  const resolveConflict = useCallback((resolution: ConflictResolution) => {
    if (!pendingTransfer) return;
    const { fromSide, conflicts, toTransfer, totalConflicts, targetFolder } = pendingTransfer;
    const [current, ...remaining] = conflicts;
    const execute = (files: FileEntry[]) => { setPendingTransfer(null); executeFiles(files, fromSide, targetFolder); };

    if (resolution === "cancel") { setPendingTransfer(null); return; }
    if (resolution === "skip") {
      if (remaining.length > 0) setPendingTransfer({ fromSide, conflicts: remaining, toTransfer, totalConflicts, targetFolder });
      else execute(toTransfer);
      return;
    }
    if (resolution === "skip-all") { execute(toTransfer); return; }
    if (resolution === "overwrite") {
      const next = [...toTransfer, current];
      if (remaining.length > 0) setPendingTransfer({ fromSide, conflicts: remaining, toTransfer: next, totalConflicts, targetFolder });
      else execute(next);
      return;
    }
    if (resolution === "overwrite-all") { execute([...toTransfer, current, ...remaining]); return; }
  }, [pendingTransfer, execTransfer, executeFiles]);

  const transfer = useCallback((direction: "LR" | "RL") => {
    const fromSide = direction === "LR" ? "left" : "right" as const;
    const srcPhase = direction === "LR" ? leftPhase : rightPhase;
    if (srcPhase.tag !== "connected" || srcPhase.selected.length === 0) return;
    void triggerTransfer(srcPhase.selected, fromSide);
  }, [leftPhase, rightPhase, triggerTransfer]);

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
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 border-r border-r-[var(--t-border)]">
          <SidePane
            host={leftHost} phase={leftPhase} refreshTick={leftRefresh}
            onPick={(h) => { setLeftHost(h); connectSide(h, setLeftPhase); }}
            onNavigate={(p) => setLeftPhase((prev) => prev.tag === "connected" ? { ...prev, cwd: p, selected: [] } : prev)}
            onSelect={(files) => setLeftPhase((prev) => prev.tag === "connected" ? { ...prev, selected: files } : prev)}
            onRefresh={() => setLeftRefresh((n) => n + 1)}
            onChangeHost={() => { disconnectSide(setLeftPhase, leftPhase); setLeftHost(null); }}
            side="left"
            onDropFiles={(files, fromSide, targetFolder) => void triggerTransfer(files, fromSide, targetFolder)}
            onTransferToTarget={(files) => void triggerTransfer(files, "left")}
            canTransferToTarget={rightPhase.tag === "connected"}
            onOpenInTerminal={makeOpenInTerminal(leftHost)}
          />
        </div>

        <div className="flex flex-col items-center justify-center gap-2 shrink-0 px-1 w-[2.933rem] bg-[var(--t-bg-card)] border-r border-r-[var(--t-border)]">
          <TransferBtn icon="lucide:arrow-right" title={transferLRTitle} disabled={!canTransferLR} onClick={() => transfer("LR")} />
          <TransferBtn icon="lucide:arrow-left"  title={transferRLTitle} disabled={!canTransferRL} onClick={() => transfer("RL")} />
        </div>

        <div className="flex-1 min-w-0">
          <SidePane
            host={rightHost} phase={rightPhase} refreshTick={rightRefresh}
            onPick={(h) => { setRightHost(h); connectSide(h, setRightPhase); }}
            onNavigate={(p) => setRightPhase((prev) => prev.tag === "connected" ? { ...prev, cwd: p, selected: [] } : prev)}
            onSelect={(files) => setRightPhase((prev) => prev.tag === "connected" ? { ...prev, selected: files } : prev)}
            onRefresh={() => setRightRefresh((n) => n + 1)}
            onChangeHost={() => { disconnectSide(setRightPhase, rightPhase); setRightHost(null); }}
            side="right"
            onDropFiles={(files, fromSide, targetFolder) => void triggerTransfer(files, fromSide, targetFolder)}
            onTransferToTarget={(files) => void triggerTransfer(files, "right")}
            canTransferToTarget={leftPhase.tag === "connected"}
            onOpenInTerminal={makeOpenInTerminal(rightHost)}
          />
        </div>
      </div>

      {pendingTransfer && (
        <ConflictDialog
          conflict={pendingTransfer.conflicts[0]}
          conflictNumber={pendingTransfer.totalConflicts - pendingTransfer.conflicts.length + 1}
          totalConflicts={pendingTransfer.totalConflicts}
          onResolve={resolveConflict}
        />
      )}

      <TransferQueue
        transfers={transfers}
        onClear={() => setTransfers((prev) => prev.filter((t) => t.status === "running"))}
        onCancel={(id) => {
          sftpCancelTransfer(id).catch(() => {});
          setTransfers((prev) => prev.map((t) => t.id === id ? { ...t, status: "cancelled" } : t));
        }}
      />
    </div>
  );
}

function TransferBtn({ icon, title, disabled, onClick }: { icon: string; title: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center justify-center w-8 h-8 rounded-lg transition-all"
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
      <Icon icon={icon} width={14} />
    </button>
  );
}
