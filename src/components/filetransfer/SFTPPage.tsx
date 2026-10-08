import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@/lib/invoke";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import {
  sftpClose,
  sftpUploadBatchTar, sftpDownloadBatchTar, sftpTransferBatchTar,
  sftpExists, fsExists, fsHomeDir, fsCopy, wslHomeDir,
  sftpRename, sftpDelete, fsRename, fsDelete, sftpCanonicalize,
  pickLocalPath, pickLocalPaths,
} from "@/services/sftp";
import { transferItem } from "@/services/sftpTransferCore";
import { runIntraPaneMove } from "./moveService";
import { hitTestDropTarget, setExternalDragHover, clearExternalDragHover } from "./internalDrag";
import { triggerUpload, downloadToLocal, batchLabel } from "./osDropPipeline";
import { accelFor, tarModeForPair, type TarMode } from "./tarSupport";
import { joinPath } from "./moveTargetCore";
import { useTransferQueueStore } from "@/stores/transferQueueStore";
import { useFileClipboardStore, type FileEndpoint } from "@/stores/fileClipboardStore";
import { buildPasteDeps, executePaste } from "./pasteService";
import { connectFileBackend } from "@/services/sftpTarget";
import { idToRelease, relinkOf } from "./sideRelink";
import { cancelKnownHostPrompt } from "@/services/knownHosts";
import { connectErrorPhase, useConnectRetry } from "@/hooks/useConnectRetry";
import {
  type HostChoice, type SidePhase, type FileEntry,
  genId,
} from "./SFTPTypes";
import { SidePane } from "./SidePane";
import { ConflictDialog } from "./ConflictDialog";
import { InternalDragGhost } from "./InternalDragGhost";
import { TabDragGhost } from "./editor/TabDragGhost";
import { triggerOsDrop as triggerOsDropPipeline } from "./osDropPipeline";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { findAnyConnection } from "@/stores/connectionStore";
import { useEditorStore } from "@/stores/editorStore";
import { EditorTabStrip } from "./editor/EditorTabStrip";
import { lazyNamed } from "@/utils/lazyNamed";
import { EditorDropOverlay } from "./editor/EditorDropOverlay";
import { isFileOnlyProtocol } from "@/utils/connectionType";

const EditorTab = lazyNamed(() => import("./editor/EditorTab"), "EditorTab");
const DiffTab = lazyNamed(() => import("./editor/DiffTab"), "DiffTab");

type Side = "left" | "right";

/** Turn a side's `sftp-closed` event into an error phase that remembers the lost
 *  session, so the reconnect relinks into it and its transfers resume. */
function useConnectionLoss(
  phase: SidePhase,
  setPhase: Dispatch<SetStateAction<SidePhase>>,
  host: HostChoice | null,
) {
  const { t } = useTranslation();
  const sftpId = phase.tag === "connected" ? phase.sftpId : null;
  useEffect(() => {
    if (!sftpId) return;
    const unlisten = listen(`sftp-closed-${sftpId}`, () => {
      setPhase((p) => p.tag === "connected" && p.sftpId === sftpId
        ? { tag: "error", message: t("fileTransfer.page.connectionLost"), host: host ?? undefined, lostSftpId: sftpId }
        : p);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [sftpId, host, setPhase, t]);
}

export default function SFTPPage() {
  const { t } = useTranslation();
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

  // A side owns at most one connect in flight and one shown session; a connect
  // that is no longer current closes its own session when it lands.
  const currentConnect = useRef<Record<Side, string | null>>({ left: null, right: null });
  const shownSftp = useRef<Record<Side, string | null>>({ left: null, right: null });
  const opening = useRef<Record<Side, string | null>>({ left: null, right: null });

  const releaseSide = useCallback((side: Side, keep?: string) => {
    currentConnect.current[side] = null;
    const openingId = opening.current[side];
    opening.current[side] = null;
    const sftpId = idToRelease(shownSftp.current[side], keep);
    if (sftpId) {
      shownSftp.current[side] = null;
      sftpClose(sftpId).catch(() => {});
    }
    // A certificate prompt nobody can answer any more would hold the connect forever.
    if (openingId) cancelKnownHostPrompt(openingId).catch(() => {});
  }, []);

  useEffect(() => () => { releaseSide("left"); releaseSide("right"); }, [releaseSide]);

  // ── Connect / disconnect ───────────────────────────────────────────────────

  const setPhaseOf = useCallback((side: Side) => (side === "left" ? setLeftPhase : setRightPhase), []);

  const connectSide = useCallback(async (host: HostChoice, side: Side, relink?: string) => {
    releaseSide(side, relink);
    const setPhase = setPhaseOf(side);
    const connectId = genId();
    currentConnect.current[side] = connectId;
    const isCurrent = () => currentConnect.current[side] === connectId;
    setPhase({ tag: "connecting", connectId, host });
    let sftpId: string | null = null;
    try {
      let cwd = "/";
      if (host.kind === "local") {
        cwd = host.wslDistro ? await wslHomeDir(host.wslDistro) : await fsHomeDir();
      } else {
        opening.current[side] = connectId;
        try {
          sftpId = await connectFileBackend(host.connection, connectId, true, relink);
        } finally {
          if (opening.current[side] === connectId) opening.current[side] = null;
        }
        if (isCurrent()) cwd = await sftpCanonicalize(sftpId, ".");
      }
      if (!isCurrent()) {
        if (sftpId && sftpId !== relink) sftpClose(sftpId).catch(() => {});
        return;
      }
      if (relink && sftpId !== relink) sftpClose(relink).catch(() => {});
      shownSftp.current[side] = sftpId;
      setPhase({ tag: "connected", sftpId, cwd, selected: [] });
    } catch (e) {
      if (sftpId && sftpId !== relink) sftpClose(sftpId).catch(() => {});
      if (isCurrent()) setPhase({ ...connectErrorPhase(e), host, lostSftpId: relink });
    }
  }, [setPhaseOf, releaseSide]);

  useEffect(() => {
    if (!sftpPanelOpen || !pendingSftpConnectionId) return;
    const conn = findAnyConnection(pendingSftpConnectionId);
    if (!conn) return;
    clearPendingSftpConnection();
    const host: HostChoice = { kind: "remote", connection: conn };
    setLeftHost(host);
    connectSide(host, "left");
  }, [sftpPanelOpen, pendingSftpConnectionId, clearPendingSftpConnection, connectSide]);

  const disconnectSide = useCallback((side: Side) => {
    releaseSide(side);
    setPhaseOf(side)({ tag: "picking" });
  }, [setPhaseOf, releaseSide]);

  // ── Auto-reconnect on error ────────────────────────────────────────────────

  const reconnectSide = (side: Side, phase: SidePhase) => () => {
    if (phase.tag === "error" && phase.host) void connectSide(phase.host, side, relinkOf(phase));
  };
  useConnectRetry(leftPhase, reconnectSide("left", leftPhase), leftHost);
  useConnectRetry(rightPhase, reconnectSide("right", rightPhase), rightHost);

  // ── Detect remote connection loss via Rust sftp-closed event ──────────────

  useConnectionLoss(leftPhase, setLeftPhase, leftHost);
  useConnectionLoss(rightPhase, setRightPhase, rightHost);

  // ── Transfers ──────────────────────────────────────────────────────────────

  const execTransfer = useCallback(async (file: FileEntry, fromSide: "left" | "right", mode: TarMode, targetFolder?: string) => {
    const src     = fromSide === "left" ? leftPhase  : rightPhase;
    const dst     = fromSide === "left" ? rightPhase : leftPhase;
    const srcHost = fromSide === "left" ? leftHost   : rightHost;
    const dstHost = fromSide === "left" ? rightHost  : leftHost;
    const dir: "→" | "←" = fromSide === "left" ? "→" : "←";
    const refreshDst = fromSide === "left" ? () => setRightRefresh((n) => n + 1) : () => setLeftRefresh((n) => n + 1);

    if (src.tag !== "connected" || dst.tag !== "connected") return;

    const dstBase = targetFolder ?? dst.cwd;
    const srcIsLocal = srcHost?.kind === "local";
    const dstIsLocal = dstHost?.kind === "local";

    await runTransfer(file.name, dir, (tid) => transferItem({
      from: srcIsLocal ? "local" : "remote",
      to: dstIsLocal ? "local" : "remote",
      srcSftpId: src.sftpId ?? undefined,
      dstSftpId: dst.sftpId ?? undefined,
      srcPath: file.path,
      dstPath: joinPath(dstBase, file.name),
      isDir: file.isDir,
      useTar: mode === "tar",
      transferId: tid,
    }), refreshDst, accelFor(mode, file.isDir));
  }, [leftPhase, rightPhase, leftHost, rightHost, runTransfer]);

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
    const label      = batchLabel(files);

    if (srcIsLocal && dstIsLocal) {
      for (const file of files) {
        await runTransfer(file.name, dir, (tid) => fsCopy(file.path, joinPath(dstBase, file.name), tid), refreshDst);
      }
    } else if (srcIsLocal && !dstIsLocal && dst.sftpId) {
      await runTransfer(label, dir, (tid) =>
        sftpUploadBatchTar({ sftpId: dst.sftpId!, localPaths: files.map((f) => f.path), remoteDir: dstBase, transferId: tid }), refreshDst, "tar");
    } else if (!srcIsLocal && dstIsLocal && src.sftpId) {
      await runTransfer(label, dir, (tid) =>
        sftpDownloadBatchTar({ sftpId: src.sftpId!, remotePaths: files.map((f) => f.path), localDir: dstBase, transferId: tid }), refreshDst, "tar");
    } else if (!srcIsLocal && !dstIsLocal && src.sftpId && dst.sftpId) {
      await runTransfer(label, dir, (tid) =>
        sftpTransferBatchTar({ srcSftpId: src.sftpId!, srcPaths: files.map((f) => f.path), dstSftpId: dst.sftpId!, dstDir: dstBase, transferId: tid }), refreshDst, "tar");
    }
  }, [leftPhase, rightPhase, leftHost, rightHost, runTransfer]);

  // Batch-tar when tar is usable, else per-file; plain SFTP if any host lacks tar.
  const executeFiles = useCallback(async (files: FileEntry[], fromSide: "left" | "right", targetFolder?: string) => {
    const src = fromSide === "left" ? leftPhase : rightPhase;
    const dst = fromSide === "left" ? rightPhase : leftPhase;
    const srcHost = fromSide === "left" ? leftHost : rightHost;
    const dstHost = fromSide === "left" ? rightHost : leftHost;
    const srcIsLocal = srcHost?.kind === "local";
    const dstIsLocal = dstHost?.kind === "local";
    const srcSftpId = src.tag === "connected" ? src.sftpId : null;
    const dstSftpId = dst.tag === "connected" ? dst.sftpId : null;
    const mode = await tarModeForPair(
      { isLocal: !!srcIsLocal, sftpId: srcSftpId },
      { isLocal: !!dstIsLocal, sftpId: dstSftpId },
    );
    if (mode === "tar" && files.length > 1) {
      await execBatchTar(files, fromSide, targetFolder);
    } else {
      for (const file of files) await execTransfer(file, fromSide, mode, targetFolder);
    }
  }, [leftPhase, rightPhase, leftHost, rightHost, execBatchTar, execTransfer]);

  const triggerTransfer = useCallback(async (files: FileEntry[], fromSide: "left" | "right", targetFolder?: string) => {
    const dst     = fromSide === "left" ? rightPhase : leftPhase;
    const dstHost = fromSide === "left" ? rightHost  : leftHost;
    if (dst.tag !== "connected") return;

    const dstIsLocal = dstHost?.kind === "local";
    const dstBase    = targetFolder ?? dst.cwd;

    const conflicts = (
      await Promise.all(files.map(async (f) => {
        const dstPath = joinPath(dstBase, f.name);
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
        execute: (files) => void executeFiles(files, fromSide, targetFolder),
      });
      return;
    }

    void executeFiles(files, fromSide, targetFolder);
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

  const moveWithin = useCallback(async (files: FileEntry[], targetDir: string, side: "left" | "right") => {
    const phase = side === "left" ? leftPhase : rightPhase;
    const host  = side === "left" ? leftHost  : rightHost;
    if (phase.tag !== "connected") return;
    const isLocal = host?.kind === "local";
    const sftpId = phase.sftpId;
    await runIntraPaneMove(files, targetDir, {
      exists: (p) => isLocal ? fsExists(p) : sftpExists(sftpId!, p),
      del:    (p) => isLocal ? fsDelete(p) : sftpDelete(sftpId!, p),
      rename: (from, to) => isLocal ? fsRename(from, to) : sftpRename(sftpId!, from, to),
      setPending,
      onRefresh: side === "left" ? () => setLeftRefresh((n) => n + 1) : () => setRightRefresh((n) => n + 1),
      onError: (m) => alert(m),
    });
  }, [leftPhase, rightPhase, leftHost, rightHost, setPending]);

  const onPaste = useCallback((dest: FileEndpoint) => {
    const clip = useFileClipboardStore.getState().clipboard;
    if (!clip) return;
    const refreshBoth = () => { setLeftRefresh((n) => n + 1); setRightRefresh((n) => n + 1); };
    const deps = buildPasteDeps(clip, dest, {
      runTransfer, setPending, refresh: refreshBoth,
      clearClipboard: useFileClipboardStore.getState().clear,
    });
    void executePaste(clip, dest, deps);
  }, [runTransfer, setPending]);

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
    const paths = await pickLocalPaths({ title: t("fileTransfer.page.selectFilesToUpload") });
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
    const dstDir = await pickLocalPath({ directory: true, title: t("fileTransfer.page.downloadToFolder") });
    if (dstDir) await downloadToLocal(files, phase.sftpId, dstDir);
  }, [leftPhase, rightPhase, leftHost, rightHost]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const { connectLocalAt, connectAt } = useSessionStore();

  const makeOpenInTerminal = useCallback((host: HostChoice | null) => {
    if (!host || (host.kind === "remote" && isFileOnlyProtocol(host.connection))) return undefined;
    return (path: string) => {
      if (host.kind === "local") {
        connectLocalAt(path).catch(() => {});
      } else {
        connectAt(host.connection.id, path).catch(() => {});
      }
    };
  }, [connectLocalAt, connectAt]);

  const leftSelected  = leftPhase.tag  === "connected" ? leftPhase.selected  : [];
  const rightSelected = rightPhase.tag === "connected" ? rightPhase.selected : [];
  const canTransferLR = leftSelected.length  > 0 && rightPhase.tag === "connected";
  const canTransferRL = rightSelected.length > 0 && leftPhase.tag  === "connected";
  const transferLRTitle = canTransferLR
    ? t("fileTransfer.page.transferLeftToRight", { count: leftSelected.length, name: leftSelected[0]?.name })
    : t("fileTransfer.page.selectFileLeft");
  const transferRLTitle = canTransferRL
    ? t("fileTransfer.page.transferRightToLeft", { count: rightSelected.length, name: rightSelected[0]?.name })
    : t("fileTransfer.page.selectFileRight");

  const hostLabelFor = (host: HostChoice | null) =>
    host == null ? t("fileTransfer.common.remoteFallback")
    : host.kind === "local" ? (host.wslDistro ?? t("fileTransfer.common.localMachine"))
    : host.connection.name?.trim() || `${host.connection.username}@${host.connection.host}`;

  const leftSingleFile  = leftSelected.length  === 1 && !leftSelected[0].isDir  ? leftSelected[0]  : null;
  const rightSingleFile = rightSelected.length === 1 && !rightSelected[0].isDir ? rightSelected[0] : null;
  const canCompare =
    leftPhase.tag === "connected" && !!leftSingleFile &&
    rightPhase.tag === "connected" && !!rightSingleFile;
  const handleCompare = () => {
    if (!canCompare || leftPhase.tag !== "connected" || rightPhase.tag !== "connected") return;
    useEditorStore.getState().openDiff(
      { sftpId: leftPhase.sftpId, path: leftSingleFile!.path, hostLabel: hostLabelFor(leftHost) },
      { sftpId: rightPhase.sftpId, path: rightSingleFile!.path, hostLabel: hostLabelFor(rightHost) },
    );
  };

  const editorTabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeTab = editorTabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="flex flex-col h-full bg-(--t-bg-base)">
      <EditorTabStrip />
      {/* Keep every open tab mounted; hide inactive ones so CodeMirror state
          (unsaved edits, scroll, dirty) survives switching tabs. */}
      <div className="relative flex flex-1 min-h-0 flex-col" style={{ display: activeTab !== null ? undefined : "none" }}>
        {editorTabs.map((tab) => (
          <div
            key={tab.id}
            className="flex-1 min-h-0 overflow-hidden"
            style={{ display: tab.id === activeTabId ? undefined : "none" }}
          >
            {tab.kind === "file" ? <EditorTab doc={tab} /> : <DiffTab doc={tab} />}
          </div>
        ))}
        <EditorDropOverlay />
      </div>
      <div className={`flex flex-1 min-h-0 gap-3 p-3${activeTab !== null ? " hidden" : ""}`}>
        <div className="flex-1 min-w-0 rounded-xl overflow-hidden border border-(--t-border)">
          <SidePane
            host={leftHost} phase={leftPhase} refreshTick={leftRefresh}
            onPick={(h) => { setLeftHost(h); connectSide(h, "left"); }}
            onNavigate={(p) => setLeftPhase((prev) => prev.tag === "connected" ? { ...prev, cwd: p, selected: [] } : prev)}
            onSelect={(files) => setLeftPhase((prev) => prev.tag === "connected" ? { ...prev, selected: files } : prev)}
            onRefresh={() => setLeftRefresh((n) => n + 1)}
            onChangeHost={() => { disconnectSide("left"); setLeftHost(null); }}
            side="left"
            onDropFiles={(files, fromSide, targetFolder) => { if (fromSide !== "panel") void triggerTransfer(files, fromSide, targetFolder); }}
            onTransferToTarget={(files) => void triggerTransfer(files, "left")}
            canTransferToTarget={rightPhase.tag === "connected"}
            onOpenInTerminal={makeOpenInTerminal(leftHost)}
            selected={leftSelected}
            onUpload={() => void uploadToSide("left")}
            onDownloadFiles={leftHost?.kind === "local" ? undefined : (files) => void downloadFromSide("left", files)}
            onMoveWithin={(files, targetFolder) => void moveWithin(files, targetFolder, "left")}
            onPaste={onPaste}
          />
        </div>

        <div className="flex flex-col items-center justify-center shrink-0 w-10">
          <div className="flex flex-col gap-1.5 p-1.5 rounded-xl border border-(--t-border) bg-(--t-bg-elevated)">
            <TransferBtn icon="lucide:arrow-right" title={transferLRTitle} disabled={!canTransferLR} onClick={() => transfer("LR")} />
            <TransferBtn icon="lucide:arrow-left"  title={transferRLTitle} disabled={!canTransferRL} onClick={() => transfer("RL")} />
            <TransferBtn icon="lucide:diff"        title={canCompare ? t("fileTransfer.page.compareTitle", { leftName: leftSingleFile!.name, rightName: rightSingleFile!.name }) : t("fileTransfer.page.compareHint")} disabled={!canCompare} onClick={handleCompare} />
          </div>
        </div>

        <div className="flex-1 min-w-0 rounded-xl overflow-hidden border border-(--t-border)">
          <SidePane
            host={rightHost} phase={rightPhase} refreshTick={rightRefresh}
            onPick={(h) => { setRightHost(h); connectSide(h, "right"); }}
            onNavigate={(p) => setRightPhase((prev) => prev.tag === "connected" ? { ...prev, cwd: p, selected: [] } : prev)}
            onSelect={(files) => setRightPhase((prev) => prev.tag === "connected" ? { ...prev, selected: files } : prev)}
            onRefresh={() => setRightRefresh((n) => n + 1)}
            onChangeHost={() => { disconnectSide("right"); setRightHost(null); }}
            side="right"
            onDropFiles={(files, fromSide, targetFolder) => { if (fromSide !== "panel") void triggerTransfer(files, fromSide, targetFolder); }}
            onTransferToTarget={(files) => void triggerTransfer(files, "right")}
            canTransferToTarget={leftPhase.tag === "connected"}
            onOpenInTerminal={makeOpenInTerminal(rightHost)}
            selected={rightSelected}
            onUpload={() => void uploadToSide("right")}
            onDownloadFiles={rightHost?.kind === "local" ? undefined : (files) => void downloadFromSide("right", files)}
            onMoveWithin={(files, targetFolder) => void moveWithin(files, targetFolder, "right")}
            onPaste={onPaste}
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
      <TabDragGhost />
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
