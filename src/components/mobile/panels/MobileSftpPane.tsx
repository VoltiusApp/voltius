import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useLongPress } from "@/components/mobile/useLongPress";
import { useTranslation } from "react-i18next";
import { appCacheDir } from "@tauri-apps/api/path";
import { breadcrumbs, type useSftpDir } from "@/services/useSftpDir";
import { formatSize, formatPermissions, formatModifiedFull, type FileEntry } from "@/components/filetransfer/SFTPTypes";
import { joinPath } from "@/components/filetransfer/moveTargetCore";
import { accelFor, tarMode } from "@/components/filetransfer/tarSupport";
import { PermissionsDialog } from "@/components/filetransfer/PermissionsDialog";
import { canEditPermissions } from "@/components/filetransfer/permissionsModel";
import { transferItem } from "@/services/sftpTransferCore";
import { useIsAndroid, useIsIOS } from "@/utils/platform";
import { downloadDirGet, downloadDirPick, downloadTempPath, downloadPublish } from "@/services/downloads";
import { needsPicker } from "@/components/terminal/androidDownloadDir";
import { useTransferQueueStore } from "@/stores/transferQueueStore";
import { writeClipboard } from "@/utils/clipboard";
import type { Connection } from "@/types";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import BottomSheet from "../sheets/BottomSheet";
import { compareStrings } from "@/utils/localeFormat";
import { describeError, type BackendErrorCode } from "@/services/backendErrors";
import { haptic } from "@/lib/haptics";
import { appToast } from "@/services/appToast";
import { useBackInterceptor } from "@/hooks/useBackInterceptor";
import { sharedAxisPlan, useSwapThrough } from "@/hooks/pageTransition";
import { PullIndicator, usePullToRefresh } from "../usePullToRefresh";
import { allSelected, pruneSelection, toggleAll, toggleItem } from "./sftpSelectionCore";
import { canShareFiles as canShareStagedFiles, shareFiles, shareStageId, shareTotalBytes, shareableFiles, SHARE_CONFIRM_BYTES } from "@/services/share";

// Coded errors arrive translated, so only an uncoded one is matched by its English text.
function isPermissionDenied(msg: string, code: BackendErrorCode | null): boolean {
  if (code) return code === "permission-denied";
  const m = msg.toLowerCase();
  return m.includes("permission denied") || m.includes("eacces");
}

type Controller = ReturnType<typeof useSftpDir>;

/**
 * One remote pane. Tap a folder to open it, a file (or its ⋮) for its actions sheet;
 * long-press a row (or tap its icon) to start selection mode, whose contextual bar is
 * portalled into `headerSlot`. Back exits selection mode first, then (when `backUp`)
 * walks up one directory at a time until "/".
 */
export default function MobileSftpPane({
  controller, connection, selected, onSelectionChange, onPickHost, onCopyToOther, otherConnected, headerSlot, onScreen, backUp,
}: {
  controller: Controller;
  connection: Connection | undefined;
  selected: FileEntry[];
  onSelectionChange: (items: FileEntry[]) => void;
  onPickHost: () => void;
  onCopyToOther: (items: FileEntry[]) => void;
  otherConnected: boolean;
  headerSlot: HTMLElement | null;
  /** The screen is showing (the SFTP tab stays mounted while hidden). */
  onScreen: boolean;
  backUp: boolean;
}) {
  const { t } = useTranslation();
  const { phase, retrying, sftpId, cwd, entries, listing, landedCwd, listError, listErrorCode, navigate, goUp, refresh, reconnect, mkdir, touch, rename, remove } = controller;
  const runTransfer = useTransferQueueStore((s) => s.runTransfer);
  const isAndroid = useIsAndroid();
  const isIOS = useIsIOS();
  const [showHidden, setShowHidden] = useState(false);
  const [sheetFor, setSheetFor] = useState<FileEntry | null>(null);
  const [renaming, setRenaming] = useState<FileEntry | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<FileEntry | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newFile, setNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [selectionMore, setSelectionMore] = useState(false);
  const [detailFor, setDetailFor] = useState<FileEntry | null>(null);
  const [permissionsFor, setPermissionsFor] = useState<FileEntry[] | null>(null);
  const [confirmShare, setConfirmShare] = useState<FileEntry[] | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const crumbsRef = useRef<HTMLDivElement | null>(null);

  const selecting = selected.length > 0;
  const startRename = (f: FileEntry) => { setRenaming(f); setRenameVal(f.name); };
  const clearSelection = () => onSelectionChange([]);

  // A failed operation: error snackbar whose Retry runs it again (and reports again if it fails again).
  const fail = (e: unknown, retry: () => Promise<unknown>) => {
    appToast("error", describeError(e, t), { action: { label: t("common.action.retry"), onClick: () => void attempt(retry) } });
  };
  const attempt = (op: () => Promise<unknown>) => op().catch((e) => fail(e, op));

  // Selection actions end selection mode, like any M3 contextual action.
  const downloadSelected = async () => { const items = selected; clearSelection(); for (const f of items) await download(f); };
  const deleteSelected = async () => {
    const items = selected;
    setConfirmBatchDelete(false); clearSelection(); haptic("confirm");
    for (const f of items) await attempt(() => remove(f));
  };

  const visible = useMemo(() => {
    const filtered = showHidden ? entries : entries.filter((e) => !e.name.startsWith("."));
    return [...filtered].sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : compareStrings(a.name, b.name)));
  }, [entries, showHidden]);

  const selectedPaths = useMemo(() => new Set(selected.map((s) => s.path)), [selected]);

  // The selection follows the listing (deleted / renamed entries drop out); leaving the folder ends it.
  useEffect(() => {
    if (!selecting || listing) return;
    const kept = pruneSelection(selected, entries);
    if (kept !== selected) onSelectionChange(kept);
  }, [entries, listing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selecting) clearSelection(); }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back: selection mode first, then one directory up (sheets opened above register later and win).
  useBackInterceptor(onScreen && selecting, clearSelection);
  useBackInterceptor(backUp && phase.tag === "connected" && cwd !== "/", goUp);

  useSwapThrough(cwd, phase.tag !== "connected" || landedCwd === cwd, () => scrollRef.current,
    (from, to) => (landedCwd === null ? null : sharedAxisPlan(to.startsWith(from.endsWith("/") ? from : `${from}/`))));

  const pull = usePullToRefresh(scrollRef, { enabled: phase.tag === "connected", busy: listing, onRefresh: refresh });

  // Keep the current folder (the last crumb) in view.
  useEffect(() => {
    const el = crumbsRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [cwd]);

  const download = async (f: FileEntry) => {
    if (!sftpId) return;
    const mode = f.isDir ? await tarMode([sftpId]) : "off";
    const fetchTo = (localPath: string, transferId: string) => transferItem({
      from: "remote", to: "local", srcSftpId: sftpId, srcPath: f.path, dstPath: localPath, isDir: f.isDir, useTar: mode === "tar", transferId,
    });
    // Android: stream to a temp path, then publish into the user's SAF download folder
    // (picked once, persisted) so the file lands somewhere visible to the system Files app.
    // iOS: same path; the folder is always the app's Documents (Files › Voltius SSH), no picker.
    if (isAndroid || isIOS) {
      try {
        let dir = await downloadDirGet();
        if (needsPicker(dir)) {
          dir = await downloadDirPick();
          if (needsPicker(dir)) return; // user cancelled the folder picker
        }
      } catch (e) {
        fail(e, () => download(f));
        return;
      }
      await runTransfer(f.name, "←", async (tid) => {
        const tmp = await downloadTempPath(tid, f.name);
        await fetchTo(tmp, tid);
        await downloadPublish(tmp, f.name);
      }, undefined, accelFor(mode, f.isDir));
      return;
    }
    await runTransfer(f.name, "←", async (tid) => fetchTo(joinPath(await appCacheDir(), f.name), tid), undefined, accelFor(mode, f.isDir));
  };

  // Share: the files download into the share staging folder (with the usual transfer cards),
  // then the system chooser gets them. Large sets ask first. Folders can't be shared.
  const canShareFiles = canShareStagedFiles();
  const share = async (items: FileEntry[], confirmed = false) => {
    const files = shareableFiles(items);
    if (!sftpId || files.length === 0) return;
    if (!confirmed && shareTotalBytes(files) > SHARE_CONFIRM_BYTES) { setConfirmShare(files); return; }
    const staged: { path: string; name: string }[] = [];
    for (const f of files) {
      await runTransfer(f.name, "←", async (tid) => {
        const tmp = await downloadTempPath(shareStageId(tid), f.name);
        await transferItem({ from: "remote", to: "local", srcSftpId: sftpId, srcPath: f.path, dstPath: tmp, isDir: false, useTar: false, transferId: tid });
        staged.push({ path: tmp, name: f.name });
      });
    }
    if (staged.length < files.length) { appToast("error", t("mobile.share.downloadFailed")); return; }
    if (!shareFiles(staged.map((x) => x.path), staged.map((x) => x.name), files.length === 1 ? files[0].name : "")) {
      appToast("error", t("mobile.share.failed"));
    }
  };

  if (!connection) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <Icon icon="lucide:folder-open" width={28} className="text-(--t-text-dim)" />
        <button data-sftp-pick-host onClick={onPickHost}
          className="px-4 py-2 rounded-xl text-sm font-medium" style={{ background: "var(--t-accent)", color: "#fff" }}>
          {t("mobile.sftp.chooseHost")}
        </button>
      </div>
    );
  }

  const single = selected.length === 1 ? selected[0] : null;
  const everything = allSelected(selected, visible);
  // M3 contextual top bar: close, count, then the selection's actions (the rarer ones under ⋮).
  const selectionBar = selecting && headerSlot && createPortal(
    <header data-sftp-selection-bar className="shrink-0 flex items-center h-12 pr-1 border-b"
      style={{ background: "color-mix(in srgb, var(--t-accent) 16%, var(--t-bg-chrome))", borderColor: "var(--t-border)" }}>
      <BarButton attr="data-sftp-sel-clear" icon="lucide:x" label={t("mobile.sftp.clearSelectionAriaLabel")} onTap={clearSelection} />
      <span data-sftp-sel-count className="flex-1 min-w-0 truncate text-base font-medium text-(--t-text-primary) tabular-nums">
        {t("mobile.sftp.selectedCount", { count: selected.length })}
      </span>
      <BarButton attr="data-sftp-sel-all" icon={everything ? "lucide:list-x" : "lucide:list-checks"} label={t("mobile.sftp.selectAll")}
        pressed={everything} onTap={() => onSelectionChange(toggleAll(selected, visible))} />
      {otherConnected && (
        <BarButton attr="data-sftp-sel-copy" icon="lucide:arrow-right-left" label={t("mobile.sftp.copyToOtherPane")} onTap={() => onCopyToOther(selected)} />
      )}
      <BarButton attr="data-sftp-sel-download" icon="lucide:download" label={t("mobile.sftp.downloadSelectedAriaLabel")} onTap={() => void downloadSelected()} />
      <BarButton attr="data-sftp-sel-delete" icon="lucide:trash-2" label={t("mobile.sftp.deleteSelectedAriaLabel")} danger onTap={() => setConfirmBatchDelete(true)} />
      <BarButton attr="data-sftp-sel-more" icon="lucide:ellipsis-vertical" label={t("mobile.sftp.moreActions")} onTap={() => setSelectionMore(true)} />
    </header>,
    headerSlot,
  );

  return (
    <div className="h-full flex flex-col min-h-0">
      {selectionBar}
      <div className="shrink-0 flex items-center h-12 border-b" style={{ borderColor: "var(--t-border)" }}>
        <button data-sftp-pane-host onClick={onPickHost} className="h-12 flex items-center gap-2 min-w-0 pl-3 pr-2 rounded-full">
          <ConnectionAvatar connection={connection} size={22} />
          <span className="text-sm font-medium text-(--t-text-primary) truncate">{connectionDisplayName(connection)}</span>
          <Icon icon="lucide:chevron-down" width={14} className="text-(--t-text-dim) shrink-0" />
        </button>
        <div className="flex-1" />
        <button data-sftp-hidden onClick={() => setShowHidden((v) => !v)} className="h-12 px-3 text-xs rounded-full"
          style={{ color: showHidden ? "var(--t-accent)" : "var(--t-text-dim)" }}>{showHidden ? t("mobile.sftp.hidden") : t("mobile.sftp.visible")}</button>
        <button data-sftp-create onClick={() => setCreating(true)} className="w-12 h-12 flex items-center justify-center rounded-full text-(--t-text-dim)" aria-label={t("common.action.create")}>
          <Icon icon="lucide:plus" width={20} />
        </button>
      </div>
      <div ref={crumbsRef} data-sftp-crumbs className="shrink-0 flex items-center h-12 px-1 overflow-x-auto scrollbar-none border-b" style={{ borderColor: "var(--t-border)" }}>
        {breadcrumbs(cwd).map((seg, i, arr) => (
          <span key={seg.path} className="flex items-center shrink-0">
            <button data-sftp-crumb={seg.path} onClick={() => navigate(seg.path)} aria-current={i === arr.length - 1 ? "location" : undefined}
              className="h-12 min-w-12 px-2 rounded-full text-sm font-medium whitespace-nowrap" style={{ color: i === arr.length - 1 ? "var(--t-text-primary)" : "var(--t-text-dim)" }}>
              {seg.name}
            </button>
            {i < arr.length - 1 && <Icon icon="lucide:chevron-right" width={14} className="text-(--t-text-dim)" />}
          </span>
        ))}
      </div>
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div ref={scrollRef} data-sftp-list className="absolute inset-0 overflow-y-auto" style={{ overscrollBehaviorY: "contain" }}>
          {phase.tag === "connecting" && (
            <div className="flex items-center justify-center pt-10 text-sm text-(--t-text-dim) gap-2">
              <Icon icon="lucide:loader-circle" width={18} className="animate-spin" /> {t("mobile.sftp.connecting")}
            </div>
          )}
          {phase.tag === "error" && (
            <div className="flex flex-col items-center gap-3 pt-10 px-6 text-center text-(--t-text-dim)">
              <Icon icon="lucide:wifi-off" width={26} className="text-(--t-status-error)" />
              <span className="text-sm text-(--t-status-error)">{phase.message}</span>
              {retrying && <span className="text-xs text-(--t-text-dim)">{t("mobile.sftp.reconnecting")}</span>}
              <button data-sftp-reconnect onClick={reconnect} className="vt-hit text-sm px-4 py-2 rounded-xl"
                style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}>{t("mobile.sftp.reconnectNow")}</button>
            </div>
          )}
          {phase.tag === "connected" && listError && (
            <div className="flex flex-col items-center gap-2 pt-10 px-6 text-center text-(--t-text-dim)">
              <Icon icon={isPermissionDenied(listError, listErrorCode) ? "lucide:lock" : "lucide:triangle-alert"} width={26} />
              <span className="text-sm">{isPermissionDenied(listError, listErrorCode) ? t("mobile.sftp.permissionDenied") : listError}</span>
              <div className="flex gap-2">
                <button data-sftp-list-retry onClick={refresh} className="vt-hit text-sm px-4 py-2 rounded-xl" style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}>{t("common.action.retry")}</button>
                <button onClick={goUp} className="vt-hit text-sm px-4 py-2 rounded-xl" style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}>{t("mobile.sftp.goUp")}</button>
              </div>
            </div>
          )}
          {phase.tag === "connected" && !listError && visible.length === 0 && !listing && (
            <div className="flex flex-col items-center gap-2 pt-10 text-(--t-text-dim)">
              <Icon icon="lucide:folder-open" width={26} /><span className="text-sm">{t("mobile.sftp.emptyFolder")}</span>
            </div>
          )}
          {phase.tag === "connected" && !listError && visible.map((f) => {
            const toggle = () => onSelectionChange(toggleItem(selected, f));
            return (
              <FileRow key={f.path} file={f} checked={selectedPaths.has(f.path)} selecting={selecting}
                moreLabel={t("mobile.sftp.itemActions", { name: f.name })}
                onTap={selecting ? toggle : f.isDir ? () => navigate(f.path) : () => setSheetFor(f)}
                onLong={selecting ? toggle : () => onSelectionChange([f])}
                onToggle={toggle}
                onMore={() => setSheetFor(f)} />
            );
          })}
        </div>
        {phase.tag === "connected" && landedCwd !== null && landedCwd !== cwd && (
          <div data-sftp-dir-loading className="absolute inset-x-0 top-10 flex justify-center pointer-events-none text-(--t-text-dim)"
            style={{ animation: "fadeIn 200ms ease-out 150ms both" }}>
            <Icon icon="lucide:loader-circle" width={22} className="animate-spin" />
          </div>
        )}
        <PullIndicator phase={pull.phase} indicatorRef={pull.indicatorRef} />
      </div>

      {sheetFor && (
        <BottomSheet title={sheetFor.name} onClose={() => setSheetFor(null)}>
          {otherConnected && <SheetItem icon="lucide:arrow-right-left" label={t("mobile.sftp.copyToOtherPane")} onTap={() => { const f = sheetFor; setSheetFor(null); onCopyToOther([f]); }} />}
          <SheetItem icon="lucide:download" label={t("mobile.sftp.download")} onTap={() => { const f = sheetFor; setSheetFor(null); void download(f); }} />
          {canShareFiles && !sheetFor.isDir && (
            <SheetItem attr="share" icon="lucide:share-2" label={t("mobile.share.action")} onTap={() => { const f = sheetFor; setSheetFor(null); void share([f]); }} />
          )}
          <SheetItem icon="lucide:info" label={t("mobile.sftp.details")} onTap={() => { setDetailFor(sheetFor); setSheetFor(null); }} />
          <SheetItem icon="lucide:text-cursor-input" label={t("common.action.rename")} onTap={() => { startRename(sheetFor); setSheetFor(null); }} />
          {sftpId && canEditPermissions([sheetFor]) && (
            <SheetItem icon="lucide:key-round" label={t("fileTransfer.pane.menu.permissions")} onTap={() => { setPermissionsFor([sheetFor]); setSheetFor(null); }} />
          )}
          <SheetItem icon="lucide:clipboard" label={t("mobile.sftp.copyPath")} onTap={() => { void writeClipboard(sheetFor.path); setSheetFor(null); }} />
          <SheetItem icon="lucide:trash-2" label={t("common.action.delete")} danger onTap={() => { setConfirmDelete(sheetFor); setSheetFor(null); }} />
        </BottomSheet>
      )}
      {selectionMore && (
        <BottomSheet title={t("mobile.sftp.selectedCount", { count: selected.length })} onClose={() => setSelectionMore(false)}>
          {canShareFiles && selected.every((f) => !f.isDir) && (
            <SheetItem attr="share" icon="lucide:share-2" label={t("mobile.share.action")} onTap={() => { const items = selected; setSelectionMore(false); clearSelection(); void share(items); }} />
          )}
          {single && <SheetItem icon="lucide:text-cursor-input" label={t("common.action.rename")} onTap={() => { setSelectionMore(false); startRename(single); clearSelection(); }} />}
          {single && <SheetItem icon="lucide:info" label={t("mobile.sftp.details")} onTap={() => { setSelectionMore(false); setDetailFor(single); clearSelection(); }} />}
          {sftpId && canEditPermissions(selected) && (
            <SheetItem icon="lucide:key-round" label={t("fileTransfer.pane.menu.permissions")} onTap={() => { setSelectionMore(false); setPermissionsFor(selected); clearSelection(); }} />
          )}
          <SheetItem icon="lucide:clipboard" label={t("mobile.sftp.copyPath")} onTap={() => { setSelectionMore(false); void writeClipboard(selected.map((f) => f.path).join("\n")); clearSelection(); }} />
        </BottomSheet>
      )}
      {renaming && (
        <BottomSheet title={t("mobile.sftp.renameTitle", { name: renaming.name })} onClose={() => setRenaming(null)}>
          <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
            className="w-full rounded-xl px-3 h-11 text-sm outline-none text-(--t-text-primary) mb-2"
            style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }} />
          <button data-sftp-rename-go className="w-full px-3 py-3 rounded-xl text-sm font-medium" style={{ background: "var(--t-accent)", color: "#fff" }}
            onClick={async () => { const f = renaming; const v = renameVal.trim(); setRenaming(null); if (v && v !== f.name) await attempt(() => rename(f, v)); }}>{t("common.action.rename")}</button>
        </BottomSheet>
      )}
      {confirmDelete && (
        <BottomSheet title={t("mobile.sftp.deleteConfirmTitle", { name: confirmDelete.name })} onClose={() => setConfirmDelete(null)}>
          <button data-sftp-delete-go className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl" style={{ color: "var(--t-status-error)" }}
            onClick={async () => { const f = confirmDelete; setConfirmDelete(null); haptic("confirm"); await attempt(() => remove(f)); }}>
            <Icon icon="lucide:trash-2" width={18} /><span className="text-sm font-medium">{t("common.action.delete")}</span>
          </button>
          <button className="w-full px-3 py-3.5 rounded-xl text-sm text-(--t-text-dim)" onClick={() => setConfirmDelete(null)}>{t("common.action.cancel")}</button>
        </BottomSheet>
      )}
      {permissionsFor && sftpId && (
        <PermissionsDialog
          touch
          sftpId={sftpId}
          files={permissionsFor}
          onClose={() => setPermissionsFor(null)}
          onApplied={() => { setPermissionsFor(null); refresh(); }}
        />
      )}
      {detailFor && (
        <BottomSheet title={detailFor.name} onClose={() => setDetailFor(null)}>
          <div className="flex flex-col gap-2 px-1 pb-1 text-sm">
            <DetailRow label={t("mobile.sftp.detail.path")} value={detailFor.path} />
            <DetailRow label={t("mobile.sftp.detail.type")} value={detailFor.isDir ? t("common.entity.folder") : detailFor.isSymlink ? t("mobile.sftp.typeSymlink") : t("mobile.sftp.typeFile")} />
            {!detailFor.isDir && <DetailRow label={t("mobile.sftp.detail.size")} value={formatSize(detailFor.size)} />}
            {detailFor.permissions != null && <DetailRow label={t("mobile.sftp.detail.permissions")} value={`${formatPermissions(detailFor.permissions)} (0o${detailFor.permissions.toString(8)})`} />}
            {detailFor.modified != null && <DetailRow label={t("mobile.sftp.detail.modified")} value={formatModifiedFull(detailFor.modified)} />}
          </div>
        </BottomSheet>
      )}
      {confirmShare && (
        <BottomSheet title={t("mobile.share.largeTitle", { size: formatSize(shareTotalBytes(confirmShare)) })} onClose={() => setConfirmShare(null)}>
          <div className="px-3 pt-1 pb-2 text-sm text-(--t-text-dim)">{t("mobile.share.largeBody")}</div>
          <button data-sftp-share-go className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-(--t-text-primary)"
            onClick={() => { const items = confirmShare; setConfirmShare(null); void share(items, true); }}>
            <Icon icon="lucide:share-2" width={18} /><span className="text-sm font-medium">{t("mobile.share.action")}</span>
          </button>
          <button className="w-full px-3 py-3.5 rounded-xl text-sm text-(--t-text-dim)" onClick={() => setConfirmShare(null)}>{t("common.action.cancel")}</button>
        </BottomSheet>
      )}
      {confirmBatchDelete && (
        <BottomSheet title={t("mobile.sftp.batchDeleteTitle", { count: selected.length })} onClose={() => setConfirmBatchDelete(false)}>
          <button data-sftp-batch-delete-go className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl" style={{ color: "var(--t-status-error)" }}
            onClick={() => void deleteSelected()}>
            <Icon icon="lucide:trash-2" width={18} /><span className="text-sm font-medium">{t("common.action.delete")}</span>
          </button>
          <button className="w-full px-3 py-3.5 rounded-xl text-sm text-(--t-text-dim)" onClick={() => setConfirmBatchDelete(false)}>{t("common.action.cancel")}</button>
        </BottomSheet>
      )}
      {creating && (
        <BottomSheet title={t("common.action.create")} onClose={() => setCreating(false)}>
          <SheetItem icon="lucide:folder-plus" label={t("mobile.snippets.newFolderTitle")} onTap={() => { setCreating(false); setNewFolder(true); }} />
          <SheetItem icon="lucide:file-plus" label={t("mobile.sftp.newFileOption")} onTap={() => { setCreating(false); setNewFile(true); }} />
        </BottomSheet>
      )}
      {newFolder && (
        <BottomSheet title={t("mobile.snippets.newFolderTitle")} onClose={() => setNewFolder(false)}>
          <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder={t("mobile.sftp.folderNamePlaceholder")}
            className="w-full rounded-xl px-3 h-11 text-sm outline-none text-(--t-text-primary) mb-2"
            style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }} />
          <button data-sftp-mkdir-go className="w-full px-3 py-3 rounded-xl text-sm font-medium" style={{ background: "var(--t-accent)", color: "#fff" }}
            onClick={async () => { const n = newFolderName.trim(); setNewFolder(false); setNewFolderName(""); if (n) await attempt(() => mkdir(n)); }}>{t("common.action.create")}</button>
        </BottomSheet>
      )}
      {newFile && (
        <BottomSheet title={t("mobile.sftp.newFileOption")} onClose={() => setNewFile(false)}>
          <input autoFocus value={newFileName} onChange={(e) => setNewFileName(e.target.value)} placeholder={t("mobile.sftp.fileNamePlaceholder")}
            className="w-full rounded-xl px-3 h-11 text-sm outline-none text-(--t-text-primary) mb-2"
            style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }} />
          <button data-sftp-touch-go className="w-full px-3 py-3 rounded-xl text-sm font-medium" style={{ background: "var(--t-accent)", color: "#fff" }}
            onClick={async () => { const n = newFileName.trim(); setNewFile(false); setNewFileName(""); if (n) await attempt(() => touch(n)); }}>{t("common.action.create")}</button>
        </BottomSheet>
      )}
    </div>
  );
}

function FileRow({ file, checked, selecting, moreLabel, onTap, onLong, onToggle, onMore }: {
  file: FileEntry; checked: boolean; selecting: boolean; moreLabel: string;
  onTap: () => void; onLong: () => void; onToggle: () => void; onMore: () => void;
}) {
  const icon = file.isDir ? "lucide:folder" : file.isSymlink ? "lucide:link" : "lucide:file";
  const press = useLongPress(onLong, onTap);
  // A div, not a button: the row holds its own ⋮ button (per-item actions, M3 list trailing icon).
  return (
    <div data-sftp-row={file.path} role="button" tabIndex={0} aria-pressed={selecting ? checked : undefined} {...press}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } }}
      className="w-full flex items-center min-h-14 pl-1 text-left border-b select-none"
      style={{ borderColor: "var(--t-border)", background: checked ? "color-mix(in srgb, var(--t-accent) 14%, transparent)" : undefined }}>
      {/* Leading icon: tapping it selects (enters selection mode), like a Gmail avatar. */}
      <span role="checkbox" aria-checked={checked} data-sftp-select={file.path}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="w-12 h-12 shrink-0 flex items-center justify-center">
        {selecting
          ? <Icon icon={checked ? "lucide:circle-check" : "lucide:circle"} width={22} style={{ color: checked ? "var(--t-accent)" : "var(--t-text-dim)" }} />
          : <Icon icon={icon} width={20} className="text-(--t-text-dim)" />}
      </span>
      <span className="flex flex-col min-w-0 flex-1 py-2 pl-1">
        <span className="text-sm text-(--t-text-primary) truncate">{file.name}</span>
        {!file.isDir && <span className="text-[11px] text-(--t-text-dim)">{formatSize(file.size)}</span>}
      </span>
      {!selecting && (
        <button data-sftp-row-actions={file.path} aria-label={moreLabel} onClick={(e) => { e.stopPropagation(); onMore(); }}
          className="w-12 h-12 shrink-0 flex items-center justify-center rounded-full text-(--t-text-dim)">
          <Icon icon="lucide:ellipsis-vertical" width={18} />
        </button>
      )}
    </div>
  );
}

function BarButton({ attr, icon, label, onTap, danger, pressed }: { attr: string; icon: string; label: string; onTap: () => void; danger?: boolean; pressed?: boolean }) {
  return (
    <button {...{ [attr]: "" }} onClick={onTap} aria-label={label} title={label} aria-pressed={pressed}
      className="w-12 h-12 shrink-0 flex items-center justify-center rounded-full"
      style={{ color: danger ? "var(--t-status-error)" : "var(--t-text-primary)" }}>
      <Icon icon={icon} width={20} />
    </button>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b" style={{ borderColor: "var(--t-border)" }}>
      <span className="text-(--t-text-dim) shrink-0 w-24">{label}</span>
      <span className="text-(--t-text-primary) break-all flex-1">{value}</span>
    </div>
  );
}

function SheetItem({ icon, label, onTap, danger, attr }: { icon: string; label: string; onTap: () => void; danger?: boolean; attr?: string }) {
  return (
    <button data-sftp-action={attr ?? label.toLowerCase().replace(/\s+/g, "-")}
      className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left active:bg-(--t-bg-card)"
      style={{ color: danger ? "var(--t-status-error)" : "var(--t-text-primary)" }} onClick={onTap}>
      <Icon icon={icon} width={18} /><span className="text-sm font-medium">{label}</span>
    </button>
  );
}
