import { useEffect, useRef, useState, Fragment } from "react";
import { Icon } from "@iconify/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDragSelection } from "@/hooks/useDragSelection";
import { DragSelectSurface } from "@/components/shared/DragSelectSurface";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import {
  sftpListDir, sftpMkdir, sftpTouch, sftpRename, sftpDelete,
  sftpCompress, sftpExtract,
  fsListDir, fsHomeDir, fsMkdir, fsRename, fsDelete, fsTouch, pickLocalPath,
  fsCompress, fsExtract,
  type RemoteFile, type LocalFile,
} from "@/services/sftp";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { type FileEntry, type SortCol, type SortDir, type VisibleCols, formatSize, formatPermissions, formatDate } from "./SFTPTypes";
import { useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { useEditorStore } from "@/stores/editorStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { startInternalDragGesture, useSemanticDragState } from "./internalDrag";

// ── SelectionActionsCtx ───────────────────────────────────────────────────────

type SelectionActionsCtx = {
  isLocal: boolean;
  sftpId: string | null;
  hostLabel: string;
  canTransferToTarget: boolean;
  onTransferToTarget?: (files: FileEntry[]) => void;
  onStartRename: (f: FileEntry) => void;
  onDelete: (files: FileEntry[]) => Promise<void>;
  onCompress: (file: FileEntry) => Promise<void>;
  onExtract: (file: FileEntry) => Promise<void>;
  onOpenInTerminal?: (path: string) => void;
  onPanelDownload?: (files: FileEntry[]) => void;
  /** Optional override for the Edit action — used by panel embedding to also open the SFTP panel. */
  onEdit?: (path: string) => void;
  setSelection: (ids: string[]) => void;
  onRefresh: () => void;
};

// ── IconBtn ───────────────────────────────────────────────────────────────────

export function IconBtn({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-colors text-(--t-text-dim)"
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-elevated)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
    >
      <Icon icon={icon} width={13} />
    </button>
  );
}

// ── FilePane ──────────────────────────────────────────────────────────────────

const DEFAULT_VISIBLE_COLS: VisibleCols = { size: true, modified: true, permissions: true };

export function FilePane({
  sftpId, isLocal, cwd, homeCwd, hostLabel = "remote",
  onNavigate, onSelect, onRefresh, refreshTick, side, onDropFiles, onMoveWithin,
  onTransferToTarget, canTransferToTarget, onChangeHost,
  filter = "", onRegisterMenuOpener, onRegisterViewMenuOpener, onOpenInTerminal,
  initialVisibleCols, onPanelDownload, onPanelUpload, onEdit,
}: {
  sftpId: string | null;
  isLocal: boolean;
  cwd: string;
  homeCwd?: string;
  /** Display label for the remote host — shown in editor tab titles. */
  hostLabel?: string;
  onNavigate: (p: string) => void;
  onSelect: (files: FileEntry[]) => void;
  onRefresh: () => void;
  refreshTick: number;
  side: "left" | "right" | "panel";
  onDropFiles: (files: FileEntry[], fromSide: "left" | "right" | "panel", targetFolder?: string) => void;
  onMoveWithin?: (files: FileEntry[], targetFolder: string) => void;
  onTransferToTarget?: (files: FileEntry[]) => void;
  canTransferToTarget?: boolean;
  onChangeHost?: () => void;
  filter?: string;
  onRegisterMenuOpener?: (opener: (anchorEl: HTMLElement) => void) => void;
  onRegisterViewMenuOpener?: (opener: (anchorEl: HTMLElement) => void) => void;
  onOpenInTerminal?: (path: string) => void;
  /** Override the default per-column visibility (used for narrow embeddings). */
  initialVisibleCols?: VisibleCols;
  /** Panel embedding only: download the given remote files to the local disk. */
  onPanelDownload?: (files: FileEntry[]) => void;
  /** Panel embedding only: pick local files and upload them to the current dir. */
  onPanelUpload?: () => void;
  /** Optional override for Edit action (panel embedding: also opens SFTP panel). */
  onEdit?: (path: string) => void;
}) {
  const [autoRefreshEnabled] = useToggle("sftp-autorefresh");
  const autoRefreshIntervalMs = useSftpSettingsStore((s) => s.autoRefreshIntervalMs);

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [colWidths, setColWidths] = useState<ColumnWidths>(DEFAULT_COLUMN_WIDTHS);
  const [visibleCols, setVisibleCols] = useState<VisibleCols>(initialVisibleCols ?? DEFAULT_VISIBLE_COLS);
  const [showHidden, setShowHidden] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [viewMenuPos, setViewMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; resolve: (ok: boolean) => void } | null>(null);

  const appConfirm = (title: string, message: string): Promise<boolean> =>
    new Promise((resolve) => setConfirmDialog({ title, message, resolve }));

  useEffect(() => {
    onRegisterMenuOpener?.((el) => {
      const r = el.getBoundingClientRect();
      setMenuPos({ x: Math.max(8, r.right - 202), y: r.bottom + 4 });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onRegisterViewMenuOpener?.((el) => {
      const r = el.getBoundingClientRect();
      setViewMenuPos({ x: Math.max(8, r.right - 180), y: r.bottom + 4 });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingFile, setCreatingFile] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [autoTick, setAutoTick] = useState(0);
  const focusIndex = useRef<number>(-1);
  const prevLocationRef = useRef({ isLocal, sftpId, cwd });

  // Drag-drop state from the pointer-driven drag controller. The pane shows
  // its overlay when a drag from the OTHER side is currently hovering over us.
  const dragSemantic = useSemanticDragState();
  const hoveringThisPane = !!dragSemantic && dragSemantic.hoverSide === side;
  // Full-pane "Drop to transfer" overlay is cross-pane only; the per-folder
  // highlight also fires for same-pane move targets.
  const isCrossPaneDrop = hoveringThisPane && dragSemantic!.side !== side;
  const dropFolderPath = hoveringThisPane ? dragSemantic!.hoverFolder : null;

  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const id = setInterval(() => setAutoTick((n) => n + 1), autoRefreshIntervalMs);
    return () => clearInterval(id);
  }, [autoRefreshEnabled, autoRefreshIntervalMs]);

  const q = filter.trim().toLowerCase();
  const filteredEntries = entries
    .filter((f) => showHidden || !f.name.startsWith("."))
    .filter((f) => !q || f.name.toLowerCase().includes(q));
  const visibleEntries = [...filteredEntries].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    // dirs always float to top regardless of sort col
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (sortCol === "size")        return dir * ((a.size ?? 0) - (b.size ?? 0));
    if (sortCol === "modified")    return dir * ((a.modified ?? 0) - (b.modified ?? 0));
    if (sortCol === "permissions") return dir * ((a.permissions ?? 0) - (b.permissions ?? 0));
    return dir * a.name.localeCompare(b.name);
  });
  const entryIds = visibleEntries.map((f) => f.path);
  const { selectedIdSet, selectionAreaRef, itemAreaRef, dragBox, handleItemSelect, handleSelectionAreaMouseDown, setSelection } =
    useDragSelection(entryIds);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    onSelectRef.current(entries.filter((f) => selectedIdSet.has(f.path)));
  }, [selectedIdSet, entries]);

  useEffect(() => {
    const prev = prevLocationRef.current;
    const isPrimaryLoad = isLocal !== prev.isLocal || sftpId !== prev.sftpId || cwd !== prev.cwd;
    prevLocationRef.current = { isLocal, sftpId, cwd };

    if (isPrimaryLoad) { setLoading(true); setError(null); }

    const load = isLocal
      ? fsListDir(cwd).then((files) =>
          files.map<FileEntry>((f: LocalFile) => ({ name: f.name, path: f.path, size: f.size, isDir: f.is_dir, modified: f.modified ?? undefined })))
      : sftpListDir(sftpId!, cwd).then((files) =>
          files.map<FileEntry>((f: RemoteFile) => ({ name: f.name, path: f.path, size: f.size, isDir: f.is_dir, modified: f.modified ?? undefined, permissions: f.permissions ?? undefined, isSymlink: f.is_symlink })));
    load
      .then((e) => { setEntries(e); if (isPrimaryLoad) setLoading(false); })
      .catch((e) => { if (isPrimaryLoad) { setError(String(e)); setLoading(false); } });
  }, [isLocal, sftpId, cwd, refreshTick, autoTick]);

  // Parent directory of cwd, or null at a filesystem/UNC root. Shared by the
  // up-button navigation and its drop-target marker.
  const computeParentDir = (): string | null => {
    const isUnc = cwd.startsWith("\\\\") || cwd.startsWith("//");
    const normalized = cwd.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    if (isUnc && parts.length <= 1) return null;
    const parentParts = parts.slice(0, -1);
    if (isUnc) return "\\\\" + parentParts.join("\\");
    if (normalized.startsWith("/")) return "/" + parentParts.join("/") || "/";
    return parentParts.length > 0 ? parentParts.join("/") : parts[0] + "/";
  };

  const parentPath = computeParentDir();
  const goUp = () => { if (parentPath) onNavigate(parentPath || "/"); };

  const handleMkdir = () => { setNewItemName(""); setCreatingFolder(true); setCreatingFile(false); };
  const handleNewFile = () => { setNewItemName(""); setCreatingFile(true); setCreatingFolder(false); };

  const commitCreateFolder = async () => {
    setCreatingFolder(false);
    if (!newItemName.trim()) return;
    const fullPath = `${cwd.replace(/\/$/, "")}/${newItemName.trim()}`;
    try {
      if (isLocal) { await fsMkdir(fullPath); }
      else if (sftpId) { await sftpMkdir(sftpId, fullPath); }
      onRefresh();
    } catch (e) { alert(String(e)); }
  };

  const commitCreateFile = async () => {
    setCreatingFile(false);
    if (!newItemName.trim()) return;
    const fullPath = `${cwd.replace(/\/$/, "")}/${newItemName.trim()}`;
    try {
      if (isLocal) { await fsTouch(fullPath); }
      else if (sftpId) { await sftpTouch(sftpId, fullPath); }
      onRefresh();
    } catch (e) { alert(String(e)); }
  };

  const selectedEntries = visibleEntries.filter((f) => selectedIdSet.has(f.path));

  const handleDelete = async (files: FileEntry[]) => {
    if (files.length === 0) return;
    if (!isLocal && !sftpId) return;
    const title = "Confirm delete";
    const msg = files.length === 1 ? `Delete "${files[0].name}"?` : `Delete ${files.length} items?`;
    const ok = await appConfirm(title, msg);
    if (!ok) return;
    try {
      for (const f of files) {
        if (isLocal) { await fsDelete(f.path); }
        else { await sftpDelete(sftpId!, f.path); }
      }
      setSelection([]);
      onRefresh();
    } catch (e) { alert(String(e)); }
  };

  const startRename = (f: FileEntry) => { setRenaming(f.path); setRenameVal(f.name); };
  const commitRename = async (f: FileEntry) => {
    if (!renameVal || renameVal === f.name) { setRenaming(null); return; }
    if (!isLocal && !sftpId) { setRenaming(null); return; }
    const sep = f.path.includes("/") ? "/" : "\\";
    const dir = f.path.substring(0, f.path.lastIndexOf(sep));
    const newPath = `${dir}${sep}${renameVal}`;
    try {
      if (isLocal) { await fsRename(f.path, newPath); }
      else { await sftpRename(sftpId!, f.path, newPath); }
      onRefresh();
    } catch (e) { alert(String(e)); }
    setRenaming(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (confirmDialog) return;
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if ((e.ctrlKey || e.metaKey) && e.key === "a") {
      e.preventDefault();
      setSelection(entryIds);
      focusIndex.current = visibleEntries.length - 1;
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const current = focusIndex.current;
      const next = e.key === "ArrowDown" ? Math.min(current + 1, visibleEntries.length - 1) : Math.max(current - 1, 0);
      if (next < 0 || next >= visibleEntries.length) return;
      focusIndex.current = next;
      if (e.shiftKey) {
        const anchor = current === -1 ? next : current;
        setSelection(entryIds.slice(Math.min(anchor, next), Math.max(anchor, next) + 1));
      } else {
        setSelection([entryIds[next]]);
      }
      return;
    }
    if (e.key === "Enter" && selectedEntries.length === 1 && selectedEntries[0].isDir) {
      onNavigate(selectedEntries[0].path);
      return;
    }
    if (selectedEntries.length > 0) {
      if (e.key === "F2" && selectedEntries.length === 1) startRename(selectedEntries[0]);
      if (e.key === "Delete" || e.key === "Backspace") void handleDelete(selectedEntries);
    }
  };

  const handleCompress = async (file: FileEntry) => {
    const sep = file.path.includes("/") ? "/" : "\\";
    const parent = file.path.substring(0, file.path.lastIndexOf(sep));
    const archivePath = `${parent}${sep}${file.name}.tar.gz`;
    try {
      if (isLocal) await fsCompress(file.path, archivePath);
      else if (sftpId) await sftpCompress(sftpId, file.path, archivePath);
      onRefresh();
    } catch (e) { alert(String(e)); }
  };

  const handleExtract = async (file: FileEntry) => {
    const sep = file.path.includes("/") ? "/" : "\\";
    const parent = file.path.substring(0, file.path.lastIndexOf(sep));
    const baseName = file.name.replace(/\.(tar\.gz|tgz)$/i, "");
    const destDir = `${parent}${sep}${baseName}`;
    try {
      if (isLocal) await fsExtract(file.path, destDir);
      else if (sftpId) await sftpExtract(sftpId, file.path, destDir);
      onRefresh();
    } catch (e) { alert(String(e)); }
  };

  const handlePickLocal = async () => {
    const path = await pickLocalPath({ directory: true, title: "Select folder" });
    if (path) onNavigate(path);
  };

  const handleGoHome = async () => {
    if (isLocal) {
      const home = await fsHomeDir();
      onNavigate(home);
    } else if (homeCwd) {
      onNavigate(homeCwd);
    }
  };

  const selectionActionsCtx: SelectionActionsCtx = {
    isLocal, sftpId, hostLabel, canTransferToTarget: canTransferToTarget ?? false,
    onTransferToTarget, onStartRename: startRename, onDelete: handleDelete,
    onCompress: handleCompress, onExtract: handleExtract,
    onOpenInTerminal, onPanelDownload, onEdit, setSelection, onRefresh,
  };

  // The pointer-driven drag controller invokes this when a drop is committed
  // on this pane. Hand off to the SFTPPage's transfer pipeline.
  const handleInternalDrop = (files: FileEntry[], fromSide: "left" | "right" | "panel", targetFolder?: string) => {
    onDropFiles(files, fromSide, targetFolder);
  };

  return (
    <div
      className="flex flex-col h-full min-w-0 relative"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      data-drop-side={side}
    >
      {isCrossPaneDrop && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center rounded-sm pointer-events-none"
          style={{ background: "color-mix(in srgb, var(--t-accent) 12%, transparent)", border: "2px solid var(--t-accent)" }}
        >
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-(--t-bg-card) border border-(--t-accent)">
            <Icon icon="lucide:arrow-down-to-line" width={14} className="text-(--t-accent)" />
            <span className="text-xs font-medium text-(--t-accent)">Drop to transfer</span>
          </div>
        </div>
      )}

      {/* Path bar */}
      <div className="flex items-center gap-1.5 px-2 py-2 shrink-0 border-b border-b-(--t-border) bg-(--t-bg-elevated)">
        <span
          {...(parentPath ? { "data-drop-folder": parentPath } : {})}
          className="rounded-md"
          style={dropFolderPath != null && parentPath != null && dropFolderPath === parentPath
            ? { background: "color-mix(in srgb, var(--t-accent) 35%, transparent)", boxShadow: "0 0 0 1px color-mix(in srgb, var(--t-accent) 70%, transparent)" }
            : undefined}
        >
          <IconBtn icon="lucide:arrow-up" title="Parent directory" onClick={goUp} />
        </span>
        <IconBtn icon="lucide:house" title="Home directory" onClick={handleGoHome} />
        <div className="flex-1 flex items-center min-w-0 px-1.5 rounded-md">
          <PathBreadcrumb cwd={cwd} isLocal={isLocal} onNavigate={onNavigate} dropFolderPath={dropFolderPath} />
          {isLocal && <IconBtn icon="lucide:folder-open" title="Browse…" onClick={handlePickLocal} />}
        </div>
        <IconBtn icon="lucide:folder-plus" title="New folder" onClick={handleMkdir} />
        <IconBtn icon="lucide:file-plus" title="New file" onClick={handleNewFile} />
        <IconBtn icon="lucide:refresh-cw" title="Refresh" onClick={onRefresh} />
      </div>

      <ColumnHeaders
        sortCol={sortCol} sortDir={sortDir} isLocal={isLocal} colWidths={colWidths} visibleCols={visibleCols}
        onSort={(col) => { if (col === sortCol) setSortDir((d) => d === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir("asc"); } }}
        onResize={(col, w) => setColWidths((prev) => ({ ...prev, [col]: w }))}
      />

      <DragSelectSurface selectionAreaRef={selectionAreaRef} onMouseDown={handleSelectionAreaMouseDown} dragBox={dragBox} className="flex-1 overflow-hidden"
        onContextMenu={(e) => { e.preventDefault(); setSelection([]); setMenuPos({ x: e.clientX, y: e.clientY }); }}>
        <VirtualFileList
          entries={visibleEntries} loading={loading} error={error}
          renaming={renaming} renameVal={renameVal} onRenameValChange={setRenameVal}
          creatingFolder={creatingFolder} creatingFile={creatingFile}
          newItemName={newItemName} onNewItemNameChange={setNewItemName}
          onCommitCreateFolder={commitCreateFolder}
          onCommitCreateFile={commitCreateFile}
          onCancelCreate={() => { setCreatingFolder(false); setCreatingFile(false); }}
          selectedIdSet={selectedIdSet} dropFolderPath={dropFolderPath}
          focusIndex={focusIndex} itemAreaRef={itemAreaRef}
          side={side} isLocal={isLocal} selectedEntries={selectedEntries}
          colWidths={colWidths} visibleCols={visibleCols}
          onCommitRename={commitRename} onCancelRename={() => setRenaming(null)}
          onItemSelect={handleItemSelect}
          onNavigate={onNavigate} onSetSelection={setSelection}
          onInternalDrop={handleInternalDrop}
          onMoveWithin={onMoveWithin}
          selectionActionsCtx={selectionActionsCtx}
        />
      </DragSelectSurface>

      {selectedIdSet.size > 1 && (
        <div className="flex items-center gap-2 px-3 py-1 shrink-0 border-t border-(--t-border) bg-(--t-bg-elevated)">
          <Icon icon="lucide:square-check-big" width={11} className="text-(--t-accent) shrink-0" />
          <span className="text-xs text-(--t-text-secondary)">
            {selectedIdSet.size} selected
            {selectedEntries.some((f) => !f.isDir) && (
              <span className="text-(--t-text-dim)"> · {formatSize(selectedEntries.filter((f) => !f.isDir).reduce((acc, f) => acc + f.size, 0))}</span>
            )}
          </span>
          <button
            className="ml-auto text-xs text-(--t-text-dim) transition-colors px-1.5 py-0.5 rounded-sm"
            style={{ background: "transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; e.currentTarget.style.color = "var(--t-text-secondary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
            onClick={() => setSelection([])}
          >
            Clear
          </button>
        </div>
      )}

      {menuPos && (
        <ContextMenu
          pos={menuPos}
          onClose={() => setMenuPos(null)}
          items={buildPaneMenuItems({
            selectedEntries, entryIds,
            selectionActionsCtx,
            handleMkdir, handleNewFile, setSelection, onChangeHost, cwd,
            onPanelUpload,
          })}
        />
      )}
      {viewMenuPos && (
        <ContextMenu
          pos={viewMenuPos}
          onClose={() => setViewMenuPos(null)}
          items={buildViewMenuItems({ showHidden, setShowHidden, visibleCols, setVisibleCols, isLocal })}
        />
      )}
      {confirmDialog && (
        <ConfirmModal
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel="Delete"
          onConfirm={() => { const r = confirmDialog.resolve; setConfirmDialog(null); r(true); }}
          onCancel={() => { const r = confirmDialog.resolve; setConfirmDialog(null); r(false); }}
        />
      )}

    </div>
  );
}

// ── buildSelectionActions ─────────────────────────────────────────────────────
// Open an editable (non-directory) file in the CodeMirror editor — local
// (sftpId null) or remote. Shared by the right-click "Edit" action and
// double-click. Returns whether the file was openable (directories are not).
export function openFileForEdit(
  file: FileEntry,
  ctx: Pick<SelectionActionsCtx, "isLocal" | "sftpId" | "hostLabel" | "onEdit">,
): boolean {
  if (file.isDir) return false;
  if (!ctx.isLocal && !ctx.sftpId) return false;
  if (ctx.onEdit) {
    ctx.onEdit(file.path);
  } else {
    useEditorStore.getState().openDoc({
      sftpId: ctx.isLocal ? null : ctx.sftpId,
      path: file.path,
      hostLabel: ctx.hostLabel,
      autoSave: useSftpSettingsStore.getState().editorAutoSave,
    });
  }
  return true;
}

// Single source of truth for file-level actions. Used by both the per-item
// right-click context menu and the pane ellipsis menu.

function buildSelectionActions(files: FileEntry[], ctx: SelectionActionsCtx): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const single = files.length === 1 ? files[0] : null;

  // Download (panel embedding only — remote → local disk)
  if (ctx.onPanelDownload && files.length > 0) {
    const multiLabel = files.length > 1 ? ` ${files.length} items` : "";
    items.push({ label: `Download${multiLabel}`, icon: "lucide:download", onClick: () => ctx.onPanelDownload!(files) });
  }

  // Transfer
  if (ctx.canTransferToTarget && files.length > 0) {
    const multiLabel = files.length > 1 ? ` ${files.length} items` : "";
    items.push({ label: `Copy${multiLabel} to target`, icon: "lucide:copy", onClick: () => ctx.onTransferToTarget?.(files) });
    if (!ctx.isLocal && ctx.sftpId) {
      const sid = ctx.sftpId;
      items.push({
        label: `Move${multiLabel} to target`, icon: "lucide:scissors",
        onClick: async () => {
          ctx.onTransferToTarget?.(files);
          for (const f of files) await sftpDelete(sid, f.path).catch(() => {});
          ctx.setSelection([]);
          ctx.onRefresh();
        },
      });
    }
  }

  // Edit (single non-dir file — local or remote)
  if (single && !single.isDir && (ctx.isLocal || ctx.sftpId)) {
    items.push({
      label: "Edit",
      icon: "lucide:file-pen",
      onClick: () => { openFileForEdit(single, ctx); },
    });
  }

  // Rename / Delete
  if (single) items.push({ label: "Rename", icon: "lucide:pencil", onClick: () => ctx.onStartRename(single) });
  if (files.length > 0) {
    items.push({
      label: files.length === 1 ? "Delete" : `Delete ${files.length} items`,
      icon: "lucide:trash-2", onClick: () => void ctx.onDelete(files), danger: true,
    });
  }

  // Archive (single file only)
  if (single) {
    items.push({ label: "Compress to .tar.gz", icon: "lucide:archive", onClick: () => ctx.onCompress(single), divider: true });
    if (!single.isDir && /\.(tar\.gz|tgz)$/i.test(single.name)) {
      items.push({ label: "Extract here", icon: "lucide:package-open", onClick: () => ctx.onExtract(single) });
    }
  }

  // Terminal (single dir only)
  if (ctx.onOpenInTerminal && single?.isDir) {
    items.push({ label: "Open in terminal", icon: "lucide:terminal", onClick: () => ctx.onOpenInTerminal!(single.path) });
  }

  return items;
}

// ── Pane menu ─────────────────────────────────────────────────────────────────

function buildViewMenuItems(ctx: {
  showHidden: boolean; setShowHidden: (v: boolean) => void;
  visibleCols: VisibleCols; setVisibleCols: React.Dispatch<React.SetStateAction<VisibleCols>>;
  isLocal: boolean;
}): ContextMenuItem[] {
  const { showHidden, setShowHidden, visibleCols, setVisibleCols, isLocal } = ctx;
  const items: ContextMenuItem[] = [];
  items.push({ label: showHidden ? "Hide hidden files" : "Show hidden files", icon: showHidden ? "lucide:eye" : "lucide:eye-off", onClick: () => setShowHidden(!showHidden) });
  items.push({ label: "Size column",        icon: visibleCols.size        ? "lucide:square-check-big" : "lucide:square", onClick: () => setVisibleCols((v) => ({ ...v, size:        !v.size        })) });
  items.push({ label: "Date column",        icon: visibleCols.modified    ? "lucide:square-check-big" : "lucide:square", onClick: () => setVisibleCols((v) => ({ ...v, modified:    !v.modified    })) });
  if (!isLocal) items.push({ label: "Permissions column", icon: visibleCols.permissions ? "lucide:square-check-big" : "lucide:square", onClick: () => setVisibleCols((v) => ({ ...v, permissions: !v.permissions })) });
  return items;
}

function buildPaneMenuItems(ctx: {
  selectedEntries: FileEntry[]; entryIds: string[];
  selectionActionsCtx: SelectionActionsCtx;
  handleMkdir: () => void;
  handleNewFile: () => void;
  setSelection: (ids: string[]) => void;
  onChangeHost?: () => void;
  cwd: string;
  onPanelUpload?: () => void;
}): ContextMenuItem[] {
  const { selectedEntries, entryIds, selectionActionsCtx,
    handleMkdir, handleNewFile, setSelection, onChangeHost, cwd, onPanelUpload } = ctx;
  const sel = selectedEntries;
  const items: ContextMenuItem[] = [];

  // ── Upload (panel embedding only — shown when nothing is selected)
  if (onPanelUpload && sel.length === 0) {
    items.push({ label: "Upload files", icon: "lucide:upload", onClick: onPanelUpload });
  }

  // ── File actions (delegated to shared builder)
  const fileActions = buildSelectionActions(sel, selectionActionsCtx);
  if (fileActions.length > 0) { fileActions[0].divider = true; items.push(...fileActions); }

  // ── Directory
  const dirActions: ContextMenuItem[] = [];
  dirActions.push({ label: "New folder", icon: "lucide:folder-plus", onClick: handleMkdir });
  dirActions.push({ label: "New file",   icon: "lucide:file-plus",   onClick: handleNewFile });
  dirActions.push({ label: "Select All", icon: "lucide:list-checks", onClick: () => setSelection(entryIds) });
  if (sel.length > 0) dirActions.push({ label: "Deselect", icon: "lucide:square", onClick: () => setSelection([]) });
  dirActions[0].divider = true; items.push(...dirActions);

  // ── Terminal for cwd (single-dir case is handled inside buildSelectionActions)
  const { onOpenInTerminal } = selectionActionsCtx;
  if (onOpenInTerminal && !(sel.length === 1 && sel[0].isDir)) {
    items.push({ label: "Open in terminal", icon: "lucide:terminal", onClick: () => onOpenInTerminal(cwd), divider: true });
  }

  // ── Connection
  if (onChangeHost) items.push({ label: "Disconnect", icon: "lucide:unplug", onClick: onChangeHost, divider: !onOpenInTerminal || (sel.length === 1 && sel[0].isDir) });

  return items;
}

// ── PathBreadcrumb ────────────────────────────────────────────────────────────

function PathBreadcrumb({ cwd, onNavigate, dropFolderPath }: { cwd: string; isLocal?: boolean; onNavigate: (p: string) => void; dropFolderPath?: string | null }) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(cwd);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setEditVal(cwd); setEditing(false); }, [cwd]);

  // Keep current dir visible — scroll to end whenever path changes
  useEffect(() => {
    if (!editing && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [cwd, editing]);

  const isUnc = cwd.startsWith("\\\\") || cwd.startsWith("//");
  const normalized = cwd.replace(/\\/g, "/");
  const isAbsolute = normalized.startsWith("/");
  const parts = normalized.split("/").filter(Boolean);
  const crumbs = parts.map((label, i) => ({
    label,
    path: isUnc
      ? "\\\\" + parts.slice(0, i + 1).join("\\")
      : (isAbsolute ? "/" : "") + parts.slice(0, i + 1).join("/"),
  }));
  const allCrumbs = isUnc || !isAbsolute ? crumbs : [{ label: "/", path: "/" }, ...crumbs];

  if (editing) {
    return (
      <input
        autoFocus
        value={editVal}
        onChange={(e) => setEditVal(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onNavigate(editVal); setEditing(false); }
          if (e.key === "Escape") setEditing(false);
        }}
        className="flex-1 text-sm px-2 py-0.5 rounded-md outline-hidden font-mono min-w-0 bg-(--t-bg-elevated) border border-(--t-accent) text-(--t-text-secondary)"
      />
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 flex items-center gap-0 min-w-0 overflow-x-auto select-none"
      style={{ scrollbarWidth: "none", cursor: "text" }}
      onClick={() => { setEditVal(cwd); setEditing(true); }}
    >
      {allCrumbs.map((crumb, i) => {
        const isLast = i === allCrumbs.length - 1;
        const isRoot = i === 0 && isAbsolute;
        return (
          <Fragment key={crumb.path}>
            {i > 1 && <span className="shrink-0 mx-0.5 text-(--t-text-dim)" style={{ fontSize: "0.8125rem", flexShrink: 0 }}>/</span>}
            <CrumbSegment
              label={isRoot ? "/" : crumb.label}
              isLast={isLast}
              isDropTarget={dropFolderPath != null && dropFolderPath === crumb.path}
              dropPath={crumb.path}
              onClick={(e) => { e.stopPropagation(); if (!isLast) onNavigate(crumb.path); else { setEditVal(cwd); setEditing(true); } }}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

function CrumbSegment({ label, isLast, isDropTarget, dropPath, onClick }: { label: string; isLast: boolean; isDropTarget?: boolean; dropPath?: string; onClick: (e: React.MouseEvent) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      data-drop-folder={dropPath}
      className="shrink-0 rounded-sm px-1 py-0.5 font-mono whitespace-nowrap"
      style={{
        fontSize: "0.8125rem",
        fontWeight: isLast ? 500 : 400,
        color: isLast
          ? "var(--t-text-primary)"
          : hovered ? "var(--t-accent)" : "var(--t-text-dim)",
        background: isDropTarget
          ? "color-mix(in srgb, var(--t-accent) 35%, transparent)"
          : hovered
            ? isLast
              ? "color-mix(in srgb, var(--t-text-primary) 6%, transparent)"
              : "color-mix(in srgb, var(--t-accent) 15%, transparent)"
            : "transparent",
        boxShadow: isDropTarget ? "0 0 0 1px color-mix(in srgb, var(--t-accent) 70%, transparent)" : undefined,
        cursor: isLast ? "text" : "pointer",
        transition: "color 0.1s, background 0.1s",
        textDecoration: !isLast && hovered ? "underline" : "none",
        textDecorationColor: "color-mix(in srgb, var(--t-accent) 55%, transparent)",
        textUnderlineOffset: "2px",
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {label}
    </button>
  );
}

// ── ColumnHeaders ─────────────────────────────────────────────────────────────

export type ColumnWidths = { name: number; size: number; modified: number; permissions: number };
export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = { name: 260, size: 72, modified: 128, permissions: 88 };

const COLUMN_MIN_WIDTHS: ColumnWidths = { name: 120, size: 56, modified: 96, permissions: 72 };
type FileColumn = keyof ColumnWidths;

function visibleDataColumns(isLocal: boolean, visibleCols: VisibleCols): FileColumn[] {
  return (["size", "modified", ...(!isLocal ? ["permissions"] : [])] as FileColumn[]).filter((col) => visibleCols[col as keyof VisibleCols]);
}

function ResizeHandle({ column, width, onWidth }: { column: FileColumn; width: number; onWidth: (w: number) => void }) {
  const startRef = useRef<{ x: number; width: number } | null>(null);
  const [isActive, setIsActive] = useState(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    startRef.current = { x: e.clientX, width };
    setIsActive(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const nextWidth = startRef.current.width + (e.clientX - startRef.current.x);
    onWidth(Math.max(COLUMN_MIN_WIDTHS[column], nextWidth));
  };

  const finishResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    startRef.current = null;
    setIsActive(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onPointerEnter={() => setIsActive(true)}
      onPointerLeave={() => { if (!startRef.current) setIsActive(false); }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      className="absolute inset-y-0 right-0 z-10 flex items-center justify-center"
      style={{
        width: 14,
        marginRight: -7,
        cursor: "col-resize",
        background: "transparent",
      }}
    >
      <div
        className="h-full transition-colors"
        style={{
          width: 2,
          background: isActive ? "var(--t-accent)" : "var(--t-text-dim)",
          opacity: isActive ? 1 : 0.9,
          boxShadow: isActive
            ? "0 0 0 1px color-mix(in srgb, var(--t-accent) 22%, transparent)"
            : "0 0 0 1px color-mix(in srgb, var(--t-bg-card) 70%, transparent)",
        }}
      />
    </div>
  );
}

function ColumnHeaders({ sortCol, sortDir, isLocal, colWidths, visibleCols, onSort, onResize }: {
  sortCol: SortCol; sortDir: SortDir; isLocal: boolean;
  colWidths: ColumnWidths; visibleCols: VisibleCols;
  onSort: (col: SortCol) => void;
  onResize: (col: FileColumn, w: number) => void;
}) {
  const chevron = (col: SortCol) => sortCol === col
    ? <Icon icon={sortDir === "asc" ? "lucide:chevron-up" : "lucide:chevron-down"} width={9} className="shrink-0" style={{ opacity: 0.7 }} />
    : null;

  const nameActive = sortCol === "name";
  const dataColumns = visibleDataColumns(isLocal, visibleCols);
  const labelStyle: React.CSSProperties = { fontSize: "0.6875rem", fontWeight: 600, letterSpacing: "0.055em", textTransform: "uppercase" };

  return (
    <div className="flex items-stretch gap-2 h-7 pl-5 pr-3 shrink-0 overflow-hidden" style={{ borderBottom: "1px solid var(--t-border)" }}>
      <button
        onClick={() => onSort("name")}
        className="relative flex-1 min-w-0 flex h-full items-center gap-0.5 text-left transition-colors"
        style={{ minWidth: colWidths.name, color: nameActive ? "var(--t-text-secondary)" : "var(--t-text-dim)" }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-secondary)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = nameActive ? "var(--t-text-secondary)" : "var(--t-text-dim)"; }}
      >
        <span className="truncate" style={labelStyle}>Name</span>
        {chevron("name")}
        <ResizeHandle column="name" width={colWidths.name} onWidth={(w) => onResize("name", w)} />
      </button>

      {dataColumns.map((col) => {
        const label = col === "size" ? "Size" : col === "modified" ? "Modified" : "Perms";
        const active = sortCol === (col as SortCol);
        return (
          <button
            key={col}
            onClick={() => onSort(col as SortCol)}
            className="relative flex h-full items-center justify-start gap-0.5 pl-2 pr-2 shrink-0 text-left transition-colors"
            style={{ width: colWidths[col], color: active ? "var(--t-text-secondary)" : "var(--t-text-dim)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-secondary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = active ? "var(--t-text-secondary)" : "var(--t-text-dim)"; }}
          >
            {chevron(col as SortCol)}
            <span className="truncate" style={labelStyle}>{label}</span>
            <ResizeHandle column={col} width={colWidths[col]} onWidth={(w) => onResize(col, w)} />
          </button>
        );
      })}
    </div>
  );
}

// ── VirtualFileList ───────────────────────────────────────────────────────────

function VirtualFileList({
  entries, loading, error,
  renaming, renameVal, onRenameValChange,
  creatingFolder, creatingFile, newItemName, onNewItemNameChange,
  onCommitCreateFolder, onCommitCreateFile, onCancelCreate,
  selectedIdSet, dropFolderPath,
  focusIndex, itemAreaRef,
  side, isLocal, selectedEntries, colWidths, visibleCols,
  onCommitRename, onCancelRename,
  onItemSelect, onNavigate, onSetSelection,
  onInternalDrop,
  onMoveWithin,
  selectionActionsCtx,
}: {
  entries: FileEntry[]; loading: boolean; error: string | null;
  renaming: string | null; renameVal: string; onRenameValChange: (v: string) => void;
  creatingFolder: boolean; creatingFile: boolean;
  newItemName: string; onNewItemNameChange: (v: string) => void;
  onCommitCreateFolder: () => void; onCommitCreateFile: () => void; onCancelCreate: () => void;
  selectedIdSet: Set<string>; dropFolderPath: string | null;
  focusIndex: React.MutableRefObject<number>; itemAreaRef: React.RefObject<HTMLDivElement | null>;
  side: "left" | "right" | "panel"; isLocal: boolean; selectedEntries: FileEntry[]; colWidths: ColumnWidths; visibleCols: VisibleCols;
  onCommitRename: (f: FileEntry) => void; onCancelRename: () => void;
  onItemSelect: (id: string, event: React.MouseEvent<HTMLDivElement>) => void;
  onNavigate: (p: string) => void; onSetSelection: (ids: string[]) => void;
  onInternalDrop: (files: FileEntry[], fromSide: "left" | "right" | "panel", targetFolder?: string) => void;
  onMoveWithin?: (files: FileEntry[], targetFolder: string) => void;
  selectionActionsCtx: SelectionActionsCtx;
}) {
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => itemAreaRef.current,
    estimateSize: () => 34,
    overscan: 15,
  });

  const commitCreate = creatingFolder ? onCommitCreateFolder : onCommitCreateFile;
  const inlineCreateRow = (creatingFolder || creatingFile) && (
    <div className="flex items-center gap-2 ml-3 mr-1 px-2 py-1.5 rounded-sm border border-(--t-accent)">
      <Icon icon={creatingFolder ? "lucide:folder" : "lucide:file"} width={15} className="shrink-0" style={{ color: creatingFolder ? "#f0c050" : "var(--t-text-dim)" }} />
      <input
        autoFocus
        value={newItemName}
        onChange={(e) => onNewItemNameChange(e.target.value)}
        onBlur={commitCreate}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitCreate();
          if (e.key === "Escape") onCancelCreate();
        }}
        placeholder={creatingFolder ? "Folder name" : "File name"}
        className="flex-1 text-sm bg-transparent outline-hidden text-(--t-text-primary) placeholder:text-(--t-text-dim)"
      />
    </div>
  );

  if (loading) {
    return (
      <div ref={itemAreaRef} data-drag-surface="true" className="h-full overflow-y-auto flex items-center justify-center">
        <Icon icon="lucide:loader-circle" className="animate-spin text-(--t-text-dim)" width={16} />
      </div>
    );
  }
  if (error) {
    return (
      <div ref={itemAreaRef} data-drag-surface="true" className="h-full overflow-y-auto px-4 py-3 text-xs text-(--t-status-error)">
        {error}
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div ref={itemAreaRef} data-drag-surface="true" className="h-full overflow-y-auto">
        {inlineCreateRow}
        {!creatingFolder && !creatingFile && (
          <div className="flex items-center justify-center h-16 text-xs text-(--t-text-dim)">Empty directory</div>
        )}
      </div>
    );
  }

  return (
    <div ref={itemAreaRef} data-drag-surface="true" className="h-full overflow-y-auto">
      {inlineCreateRow}
      <div data-drag-surface="true" className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
          const file = entries[virtualItem.index];
          const isSelected = selectedIdSet.has(file.path);
          const isDragHover = dropFolderPath === file.path && file.isDir;
          const itemStyle: React.CSSProperties = { position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualItem.start}px)` };

          if (renaming === file.path) {
            return (
              <div key={file.path} style={itemStyle}>
                <div className="flex items-center gap-2 ml-3 mr-1 px-2 py-1.5 rounded-sm border border-(--t-accent)">
                  <Icon icon={file.isDir ? "lucide:folder" : "lucide:file"} width={15} className="shrink-0" style={{ color: file.isDir ? "#f0c050" : "var(--t-text-dim)" }} />
                  <input
                    autoFocus
                    value={renameVal}
                    onChange={(e) => onRenameValChange(e.target.value)}
                    onBlur={() => onCommitRename(file)}
                    onKeyDown={(e) => { if (e.key === "Enter") onCommitRename(file); if (e.key === "Escape") onCancelRename(); }}
                    className="flex-1 text-sm bg-transparent outline-hidden text-(--t-text-primary)"
                  />
                </div>
              </div>
            );
          }

          const filesToDelete = isSelected && selectedEntries.length > 1 ? selectedEntries : [file];
          const contextActions = buildSelectionActions(filesToDelete, selectionActionsCtx);

          return (
            <div
              key={file.path}
              data-drag-surface="true"
              style={itemStyle}
              {...(file.isDir ? { "data-drop-folder": file.path } : {})}
            >
              <FileRow
                file={file}
                isSelected={isSelected}
                isDragHover={isDragHover}
                isLocal={isLocal}
                colWidths={colWidths}
                visibleCols={visibleCols}
                selectableId={file.path}
                onClick={(e) => { focusIndex.current = virtualItem.index; onItemSelect(file.path, e as React.MouseEvent<HTMLDivElement>); }}
                onDoubleClick={() => { if (file.isDir) onNavigate(file.path); else openFileForEdit(file, selectionActionsCtx); }}
                contextActions={contextActions.length > 0 ? contextActions : undefined}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  // Don't initiate a drag on modifier-clicks (which extend/toggle selection).
                  if (e.shiftKey || e.ctrlKey || e.metaKey) return;
                  const filesToDrag = isSelected && selectedEntries.length > 0 ? selectedEntries : [file];
                  startInternalDragGesture({
                    side,
                    files: filesToDrag,
                    startX: e.clientX,
                    startY: e.clientY,
                    onActivate: () => {
                      if (!isSelected) { onSetSelection([file.path]); focusIndex.current = virtualItem.index; }
                    },
                    onDrop: onInternalDrop,
                    onMoveWithin,
                  });
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── FileRow ───────────────────────────────────────────────────────────────────

function FileRow({ file, isSelected, isDragHover, isLocal, colWidths, visibleCols, selectableId, onClick, onDoubleClick, contextActions, onPointerDown }: {
  file: FileEntry; isSelected: boolean; isDragHover?: boolean; isLocal: boolean; colWidths: ColumnWidths; visibleCols: VisibleCols; selectableId?: string;
  onClick: (e: React.MouseEvent) => void; onDoubleClick: () => void;
  contextActions?: ContextMenuItem[];
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const { pos, open, close } = useContextMenu();
  const [hovered, setHovered] = useState(false);
  const dimColor = isSelected ? "var(--t-text-secondary)" : "var(--t-text-dim)";
  const dataColumns = visibleDataColumns(isLocal, visibleCols);

  let bg = "transparent";
  let border = "1px solid transparent";
  if (isDragHover) { bg = "color-mix(in srgb, var(--t-accent) 35%, transparent)"; border = "1px solid color-mix(in srgb, var(--t-accent) 70%, transparent)"; }
  else if (isSelected) { bg = "color-mix(in srgb, var(--t-accent) 22%, transparent)"; border = "1px solid color-mix(in srgb, var(--t-accent) 45%, transparent)"; }
  else if (hovered) { bg = "color-mix(in srgb, var(--t-text-primary) 5%, transparent)"; border = "1px solid color-mix(in srgb, var(--t-text-primary) 6%, transparent)"; }

  return (
    <div
      data-selectable-id={selectableId}
      className="flex items-center gap-2 px-2 py-1.5 my-px mr-1 ml-3 rounded-sm transition-colors cursor-default select-none relative"
      style={{ background: bg, border }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={onPointerDown}
      onContextMenu={(e) => { e.stopPropagation(); if (contextActions?.length) { if (!isSelected) onClick(e); open(e); } else { e.preventDefault(); } }}
    >
      <Icon
        icon={file.isSymlink ? "lucide:square-arrow-out-up-right" : file.isDir ? "lucide:folder" : "lucide:file"}
        width={15} className="shrink-0"
        style={{ color: file.isDir ? "#f0c050" : file.isSymlink ? "var(--t-accent)" : "var(--t-text-dim)" }}
      />
      <span className="text-sm truncate text-(--t-text-primary) min-w-0 flex-1">{file.name}</span>
      {dataColumns.map((col) => (
        <span key={col} className="text-xs text-right shrink-0 truncate font-mono" style={{ width: colWidths[col], color: dimColor }}>
          {col === "size" ? (!file.isDir ? formatSize(file.size) : "") : col === "modified" ? (file.modified != null ? formatDate(file.modified) : "") : (file.permissions != null ? formatPermissions(file.permissions) : "")}
        </span>
      ))}
      {pos && contextActions && <ContextMenu items={contextActions} pos={pos} onClose={close} />}
    </div>
  );
}
