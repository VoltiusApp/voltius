import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "@/stores/sessionStore";
import { usePanelSftpStore } from "@/stores/panelSftpStore";
import { useTerminalCwdStore } from "@/stores/terminalCwdStore";
import { useTransferQueueStore } from "@/stores/transferQueueStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import {
  pickLocalPath, pickLocalPaths,
  sftpDownload, sftpDownloadDir, sftpDownloadDirTar, sftpDownloadBatchTar,
} from "@/services/sftp";
import { FilePane } from "@/components/filetransfer/FilePane";
import { TransferQueue } from "@/components/filetransfer/TransferQueue";
import { triggerOsDrop, triggerUpload } from "@/components/filetransfer/osDropPipeline";
import { hitTestDropTarget, setExternalDragHover, clearExternalDragHover } from "@/components/filetransfer/internalDrag";
import type { FileEntry, VisibleCols } from "@/components/filetransfer/SFTPTypes";

const PANEL_VISIBLE_COLS: VisibleCols = { size: false, modified: false, permissions: false };

export default function PanelSftpSection() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const session = useSessionStore((s) => s.sessions.find((sess) => sess.id === s.activeSessionId));
  const panelState = usePanelSftpStore((s) => (activeSessionId ? s.sessions[activeSessionId] : undefined));
  const ensureConnected = usePanelSftpStore((s) => s.ensureConnected);
  const setPanelCwd = usePanelSftpStore((s) => s.setCwd);
  const setFollowCwd = usePanelSftpStore((s) => s.setFollowCwd);
  const terminalCwd = useTerminalCwdStore((s) => (activeSessionId ? s.cwds[activeSessionId] : undefined));
  const runTransfer = useTransferQueueStore((s) => s.runTransfer);
  const transfers = useTransferQueueStore((s) => s.transfers);
  const clearCompleted = useTransferQueueStore((s) => s.clearCompleted);
  const cancelTransfer = useTransferQueueStore((s) => s.cancelTransfer);
  const [tarTransferEnabled] = useToggle("sftp-tar");

  const [selected, setSelected] = useState<FileEntry[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const viewBtnRef = useRef<HTMLButtonElement>(null);
  const [menuOpener, setMenuOpener] = useState<((el: HTMLElement) => void) | null>(null);
  const [viewMenuOpener, setViewMenuOpener] = useState<((el: HTMLElement) => void) | null>(null);

  // ── Connection lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    if (!session || session.status !== "connected") return;
    if (session.type !== "ssh" && session.type !== "local") return;
    void ensureConnected(session);
  }, [session, ensureConnected]);

  // Reset selection when switching sessions to avoid stale entries belonging
  // to a different host.
  useEffect(() => { setSelected([]); }, [activeSessionId]);

  // ── Follow cwd ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeSessionId || !panelState || panelState.tag !== "connected") return;
    if (!panelState.followCwd || !terminalCwd) return;
    if (panelState.cwd === terminalCwd) return;
    setPanelCwd(activeSessionId, terminalCwd);
  }, [activeSessionId, panelState, terminalCwd, setPanelCwd]);

  const handleNavigate = useCallback((p: string) => {
    if (!activeSessionId) return;
    // Manual navigation breaks the follow link.
    if (panelState?.tag === "connected" && panelState.followCwd) {
      setFollowCwd(activeSessionId, false);
    }
    setPanelCwd(activeSessionId, p);
  }, [activeSessionId, panelState, setFollowCwd, setPanelCwd]);

  const toggleFollow = useCallback(() => {
    if (!activeSessionId || panelState?.tag !== "connected") return;
    const next = !panelState.followCwd;
    setFollowCwd(activeSessionId, next);
    // Re-enabling follow snaps immediately to the terminal's current cwd.
    if (next && terminalCwd && terminalCwd !== panelState.cwd) {
      setPanelCwd(activeSessionId, terminalCwd);
    }
  }, [activeSessionId, panelState, setFollowCwd, setPanelCwd, terminalCwd]);

  // ── OS drag-drop (upload) ───────────────────────────────────────────────────
  // Tauri allows multiple onDragDropEvent listeners. Hit-test uses side="panel"
  // so SFTPPage's listener (which switches on "left"/"right") ignores them.
  useEffect(() => {
    if (panelState?.tag !== "connected") return;
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const p = event.payload;
        const dpr = window.devicePixelRatio || 1;
        if (p.type === "enter" || p.type === "over") {
          const { x, y } = p.position;
          const hit = hitTestDropTarget(x / dpr, y / dpr, null);
          if (hit.side === "panel") setExternalDragHover("panel", hit.folder);
        } else if (p.type === "drop") {
          clearExternalDragHover();
          const { x, y } = p.position;
          const hit = hitTestDropTarget(x / dpr, y / dpr, null);
          if (hit.side === "panel" && p.paths.length > 0 && panelState.tag === "connected") {
            void triggerOsDrop(p.paths, {
              isLocal: panelState.isLocal,
              sftpId: panelState.sftpId,
              cwd: hit.folder ?? panelState.cwd,
              onRefresh: () => setRefreshTick((n) => n + 1),
            });
          }
        } else {
          clearExternalDragHover();
        }
      });
      if (cancelled) unlisten();
      else unlistenFn = unlisten;
    })();
    return () => { cancelled = true; unlistenFn?.(); };
  }, [panelState]);

  // ── Upload / download buttons ───────────────────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (panelState?.tag !== "connected") return;
    const paths = await pickLocalPaths({ title: "Select files to upload" });
    if (paths.length === 0) return;
    // Use osDropPipeline so directory uploads + conflict resolution work the
    // same way as drag-drop. Stat each path for is_dir before piping.
    const items: FileEntry[] = [];
    for (const path of paths) {
      try {
        const isDir = await invoke<boolean | null>("fs_stat", { path });
        if (isDir === null) continue;
        const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
        items.push({ name, path, size: 0, isDir });
      } catch { /* skip */ }
    }
    await triggerUpload(items, {
      isLocal: panelState.isLocal,
      sftpId: panelState.sftpId,
      cwd: panelState.cwd,
      onRefresh: () => setRefreshTick((n) => n + 1),
    });
  }, [panelState]);

  const canDownload = panelState?.tag === "connected" && !panelState.isLocal && selected.length > 0;
  const downloadFiles = useCallback(async (files: FileEntry[]) => {
    if (files.length === 0 || panelState?.tag !== "connected" || panelState.isLocal || !panelState.sftpId) return;
    const dstDir = await pickLocalPath({ directory: true, title: "Download to folder" });
    if (!dstDir) return;
    const sftpId = panelState.sftpId;
    const base = dstDir.replace(/[\\/]$/, "");
    const label = files.length === 1 ? files[0].name : `${files.length} items`;

    if (tarTransferEnabled && files.length > 1) {
      await runTransfer(label, "←", (tid) =>
        sftpDownloadBatchTar({ sftpId, remotePaths: files.map((f) => f.path), localDir: base, transferId: tid }),
      );
      return;
    }

    for (const file of files) {
      const sep = /[\\/]/.test(base) && /\\/.test(base) ? "\\" : "/";
      const localPath = `${base}${sep}${file.name}`;
      await runTransfer(file.name, "←", (tid) => file.isDir
        ? (tarTransferEnabled
            ? sftpDownloadDirTar({ sftpId, remotePath: file.path, localPath, transferId: tid })
            : sftpDownloadDir({ sftpId, remotePath: file.path, localPath, transferId: tid }))
        : sftpDownload({ sftpId, remotePath: file.path, localPath, transferId: tid }),
      );
    }
  }, [panelState, runTransfer, tarTransferEnabled]);
  const handleDownload = useCallback(() => { void downloadFiles(selected); }, [downloadFiles, selected]);

  // ── Layout ──────────────────────────────────────────────────────────────────

  const headerStatus = useMemo(() => {
    if (!session) return "No active session";
    if (session.status !== "connected") return "Waiting for session";
    if (!panelState || panelState.tag === "connecting") return "Connecting…";
    if (panelState.tag === "error") return panelState.message;
    return null;
  }, [session, panelState]);

  const isReady = panelState?.tag === "connected";

  return (
    <div className="flex flex-col h-full">
      {/* Header: follow toggle, upload, download, ellipsis */}
      <div className="flex items-center gap-1 px-2 py-1.5 shrink-0 border-b border-b-[var(--t-border)]">
        <HeaderBtn
          icon={isReady && panelState.followCwd ? "lucide:link" : "lucide:link-2-off"}
          title={isReady && panelState.followCwd ? "Following terminal cwd · click to unpin" : "Follow terminal cwd"}
          active={isReady && panelState.followCwd}
          disabled={!isReady}
          onClick={toggleFollow}
        />
        <div className="flex-1" />
        <HeaderBtn
          icon="lucide:upload"
          title="Upload files"
          disabled={!isReady}
          onClick={handleUpload}
        />
        <HeaderBtn
          icon="lucide:download"
          title={canDownload ? `Download ${selected.length === 1 ? `"${selected[0].name}"` : `${selected.length} items`}` : "Select files to download"}
          disabled={!canDownload}
          onClick={handleDownload}
        />
        <button
          ref={viewBtnRef}
          title="View options"
          disabled={!isReady}
          onClick={() => viewBtnRef.current && viewMenuOpener?.(viewBtnRef.current)}
          className="flex items-center justify-center w-7 h-7 rounded-md shrink-0 transition-colors text-[var(--t-text-dim)] disabled:opacity-40"
          onMouseEnter={(e) => { if (isReady) { e.currentTarget.style.background = "var(--t-bg-elevated)"; e.currentTarget.style.color = "var(--t-text-primary)"; } }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
        >
          <Icon icon="lucide:layout-list" width={14} />
        </button>
        <button
          ref={menuBtnRef}
          title="More options"
          disabled={!isReady}
          onClick={() => menuBtnRef.current && menuOpener?.(menuBtnRef.current)}
          className="flex items-center justify-center w-7 h-7 rounded-md shrink-0 transition-colors text-[var(--t-text-dim)] disabled:opacity-40"
          onMouseEnter={(e) => { if (isReady) { e.currentTarget.style.background = "var(--t-bg-elevated)"; e.currentTarget.style.color = "var(--t-text-primary)"; } }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
        >
          <Icon icon="lucide:ellipsis-vertical" width={14} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {headerStatus && (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
            {panelState?.tag === "error" ? (
              <Icon icon="lucide:wifi-off" width={20} className="text-[var(--t-status-error)]" />
            ) : panelState?.tag === "connecting" ? (
              <Icon icon="lucide:loader-2" width={16} className="animate-spin text-[var(--t-text-dim)]" />
            ) : (
              <Icon icon="lucide:folder-tree" width={20} className="text-[var(--t-text-dim)]" />
            )}
            <p className={`text-xs ${panelState?.tag === "error" ? "text-[var(--t-status-error)]" : "text-[var(--t-text-dim)]"}`}>{headerStatus}</p>
          </div>
        )}

        {isReady && activeSessionId && (
          <FilePane
            sftpId={panelState.sftpId}
            isLocal={panelState.isLocal}
            cwd={panelState.cwd}
            onNavigate={handleNavigate}
            onSelect={setSelected}
            onRefresh={() => setRefreshTick((n) => n + 1)}
            refreshTick={refreshTick}
            side="panel"
            onDropFiles={() => { /* internal drag-out is disabled for panel embedding */ }}
            initialVisibleCols={PANEL_VISIBLE_COLS}
            onPanelUpload={handleUpload}
            onPanelDownload={panelState.isLocal ? undefined : (files) => void downloadFiles(files)}
            onRegisterMenuOpener={(opener) => setMenuOpener(() => opener)}
            onRegisterViewMenuOpener={(opener) => setViewMenuOpener(() => opener)}
          />
        )}
      </div>

      {/* Transfers dock inside the panel so the queue stays within the panel
          card rather than the viewport-corner global widget (which is wider
          than the panel and overflows it). */}
      {transfers.length > 0 && (
        <TransferQueue transfers={transfers} onClear={clearCompleted} onCancel={cancelTransfer} />
      )}
    </div>
  );
}

function HeaderBtn({ icon, title, disabled, active, onClick }: {
  icon: string; title: string; disabled?: boolean; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center justify-center w-7 h-7 rounded-md shrink-0 transition-colors"
      style={{
        color: disabled ? "var(--t-text-dim)" : active ? "var(--t-accent)" : "var(--t-text-dim)",
        background: active ? "color-mix(in srgb, var(--t-accent) 14%, transparent)" : "transparent",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => { if (!disabled && !active) { e.currentTarget.style.background = "var(--t-bg-elevated)"; e.currentTarget.style.color = "var(--t-text-primary)"; } }}
      onMouseLeave={(e) => { if (!disabled && !active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; } }}
    >
      <Icon icon={icon} width={14} />
    </button>
  );
}
