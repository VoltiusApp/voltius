import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { appCacheDir } from "@tauri-apps/api/path";
import { breadcrumbs, type useSftpDir } from "@/services/useSftpDir";
import { formatSize, formatPermissions, formatDate, type FileEntry } from "@/components/filetransfer/SFTPTypes";
import { sftpDownload, sftpDownloadDir } from "@/services/sftp";
import { useTransferQueueStore } from "@/stores/transferQueueStore";
import { writeClipboard } from "@/utils/clipboard";
import type { Connection } from "@/types";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import BottomSheet from "../sheets/BottomSheet";

function isPermissionDenied(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("permission denied") || m.includes("eacces");
}

type Controller = ReturnType<typeof useSftpDir>;

export default function MobileSftpPane({
  controller, connection, selected, onToggleSelect, onPickHost, onCopyToOther, otherConnected, onClearSelect,
}: {
  controller: Controller;
  connection: Connection | undefined;
  selected: FileEntry[];
  onToggleSelect: (f: FileEntry) => void;
  onPickHost: () => void;
  onCopyToOther: (f: FileEntry) => void;
  otherConnected: boolean;
  onClearSelect: () => void;
}) {
  const { phase, sftpId, cwd, entries, listing, listError, navigate, goUp, mkdir, touch, rename, remove } = controller;
  const runTransfer = useTransferQueueStore((s) => s.runTransfer);
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
  const [detailFor, setDetailFor] = useState<FileEntry | null>(null);

  const downloadSelected = async () => { for (const f of selected) await download(f); };
  const deleteSelected = async () => {
    for (const f of selected) { try { await remove(f); } catch (e) { alert(String(e)); } }
    setConfirmBatchDelete(false); onClearSelect();
  };

  const visible = useMemo(() => {
    const filtered = showHidden ? entries : entries.filter((e) => !e.name.startsWith("."));
    return [...filtered].sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
  }, [entries, showHidden]);

  const selectedPaths = useMemo(() => new Set(selected.map((s) => s.path)), [selected]);

  const download = async (f: FileEntry) => {
    if (!sftpId) return;
    const base = (await appCacheDir()).replace(/\/$/, "");
    const localPath = `${base}/${f.name}`;
    await runTransfer(f.name, "←", (tid) => (f.isDir
      ? sftpDownloadDir({ sftpId, remotePath: f.path, localPath, transferId: tid })
      : sftpDownload({ sftpId, remotePath: f.path, localPath, transferId: tid })));
  };

  if (!connection) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <Icon icon="lucide:folder-open" width={28} className="text-(--t-text-dim)" />
        <button data-sftp-pick-host onClick={onPickHost}
          className="px-4 py-2 rounded-xl text-sm font-medium" style={{ background: "var(--t-accent)", color: "#fff" }}>
          Choose a host
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b" style={{ borderColor: "var(--t-border)" }}>
        <button data-sftp-pane-host onClick={onPickHost} className="flex items-center gap-1.5 min-w-0">
          <ConnectionAvatar connection={connection} size={20} />
          <span className="text-xs font-medium text-(--t-text-primary) truncate">{connectionDisplayName(connection)}</span>
          <Icon icon="lucide:chevron-down" width={12} className="text-(--t-text-dim) shrink-0" />
        </button>
        <div className="flex-1" />
        <button data-sftp-hidden onClick={() => setShowHidden((v) => !v)} className="px-2 py-0.5 text-[11px] rounded-lg"
          style={{ color: showHidden ? "var(--t-accent)" : "var(--t-text-dim)" }}>{showHidden ? "Hidden" : "Visible"}</button>
        <button data-sftp-create onClick={() => setCreating(true)} className="p-1 rounded-lg text-(--t-text-dim)" aria-label="Create">
          <Icon icon="lucide:plus" width={16} />
        </button>
      </div>
      <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 overflow-x-auto border-b" style={{ borderColor: "var(--t-border)" }}>
        {breadcrumbs(cwd).map((seg, i, arr) => (
          <span key={seg.path} className="flex items-center gap-1 shrink-0">
            <button data-sftp-crumb={seg.path} onClick={() => navigate(seg.path)}
              className="text-xs font-medium whitespace-nowrap" style={{ color: i === arr.length - 1 ? "var(--t-text-primary)" : "var(--t-text-dim)" }}>
              {seg.name}
            </button>
            {i < arr.length - 1 && <Icon icon="lucide:chevron-right" width={12} className="text-(--t-text-dim)" />}
          </span>
        ))}
      </div>
      {selected.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b" style={{ borderColor: "var(--t-border)", background: "var(--t-bg-chrome)" }}>
          <span className="text-xs font-medium text-(--t-text-primary)">{selected.length} selected</span>
          <div className="flex-1" />
          <button data-sftp-sel-download onClick={() => void downloadSelected()} className="p-1.5 rounded-lg text-(--t-text-dim)" aria-label="Download selected">
            <Icon icon="lucide:download" width={16} />
          </button>
          <button data-sftp-sel-delete onClick={() => setConfirmBatchDelete(true)} className="p-1.5 rounded-lg" style={{ color: "var(--t-status-error)" }} aria-label="Delete selected">
            <Icon icon="lucide:trash-2" width={16} />
          </button>
          <button data-sftp-sel-clear onClick={onClearSelect} className="p-1.5 rounded-lg text-(--t-text-dim)" aria-label="Clear selection">
            <Icon icon="lucide:x" width={16} />
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto min-h-0">
        {phase.tag === "connecting" && (
          <div className="flex items-center justify-center pt-10 text-sm text-(--t-text-dim) gap-2">
            <Icon icon="lucide:loader-2" width={18} className="animate-spin" /> Connecting…
          </div>
        )}
        {phase.tag === "error" && (
          <div className="flex flex-col items-center gap-3 pt-10 px-6 text-center text-(--t-text-dim)">
            <Icon icon="lucide:wifi-off" width={26} className="text-(--t-status-error)" />
            <span className="text-sm text-(--t-status-error)">{phase.message}</span>
          </div>
        )}
        {phase.tag === "connected" && listError && (
          <div className="flex flex-col items-center gap-2 pt-10 px-6 text-center text-(--t-text-dim)">
            <Icon icon={isPermissionDenied(listError) ? "lucide:lock" : "lucide:triangle-alert"} width={26} />
            <span className="text-sm">{isPermissionDenied(listError) ? "Permission denied" : listError}</span>
            <button onClick={goUp} className="text-sm px-4 py-2 rounded-xl" style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}>Go up</button>
          </div>
        )}
        {phase.tag === "connected" && !listError && visible.length === 0 && !listing && (
          <div className="flex flex-col items-center gap-2 pt-10 text-(--t-text-dim)">
            <Icon icon="lucide:folder-open" width={26} /><span className="text-sm">Empty folder</span>
          </div>
        )}
        {phase.tag === "connected" && !listError && visible.map((f) => (
          <FileRow key={f.path} file={f} checked={selectedPaths.has(f.path)}
            onTap={() => (f.isDir ? navigate(f.path) : onToggleSelect(f))}
            onToggle={() => onToggleSelect(f)}
            onLong={() => setSheetFor(f)} />
        ))}
      </div>

      {sheetFor && (
        <BottomSheet title={sheetFor.name} onClose={() => setSheetFor(null)}>
          {otherConnected && <SheetItem icon="lucide:arrow-right-left" label="Copy to other pane" onTap={() => { const f = sheetFor; setSheetFor(null); onCopyToOther(f); }} />}
          <SheetItem icon="lucide:download" label="Download" onTap={() => { const f = sheetFor; setSheetFor(null); void download(f); }} />
          <SheetItem icon="lucide:info" label="Details" onTap={() => { setDetailFor(sheetFor); setSheetFor(null); }} />
          <SheetItem icon="lucide:pencil" label="Rename" onTap={() => { setRenaming(sheetFor); setRenameVal(sheetFor.name); setSheetFor(null); }} />
          <SheetItem icon="lucide:clipboard" label="Copy path" onTap={() => { void writeClipboard(sheetFor.path); setSheetFor(null); }} />
          <SheetItem icon="lucide:trash-2" label="Delete" danger onTap={() => { setConfirmDelete(sheetFor); setSheetFor(null); }} />
        </BottomSheet>
      )}
      {renaming && (
        <BottomSheet title={`Rename ${renaming.name}`} onClose={() => setRenaming(null)}>
          <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
            className="w-full rounded-xl px-3 h-11 text-sm outline-none text-(--t-text-primary) mb-2"
            style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }} />
          <button data-sftp-rename-go className="w-full px-3 py-3 rounded-xl text-sm font-medium" style={{ background: "var(--t-accent)", color: "#fff" }}
            onClick={async () => { const f = renaming; const v = renameVal.trim(); setRenaming(null); if (v && v !== f.name) try { await rename(f, v); } catch (e) { alert(String(e)); } }}>Rename</button>
        </BottomSheet>
      )}
      {confirmDelete && (
        <BottomSheet title={`Delete ${confirmDelete.name}?`} onClose={() => setConfirmDelete(null)}>
          <button data-sftp-delete-go className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl" style={{ color: "var(--t-status-error)" }}
            onClick={async () => { const f = confirmDelete; setConfirmDelete(null); try { await remove(f); } catch (e) { alert(String(e)); } }}>
            <Icon icon="lucide:trash-2" width={18} /><span className="text-sm font-medium">Delete</span>
          </button>
          <button className="w-full px-3 py-3.5 rounded-xl text-sm text-(--t-text-dim)" onClick={() => setConfirmDelete(null)}>Cancel</button>
        </BottomSheet>
      )}
      {detailFor && (
        <BottomSheet title={detailFor.name} onClose={() => setDetailFor(null)}>
          <div className="flex flex-col gap-2 px-1 pb-1 text-sm">
            <DetailRow label="Path" value={detailFor.path} />
            <DetailRow label="Type" value={detailFor.isDir ? "Folder" : detailFor.isSymlink ? "Symlink" : "File"} />
            {!detailFor.isDir && <DetailRow label="Size" value={formatSize(detailFor.size)} />}
            {detailFor.permissions != null && <DetailRow label="Permissions" value={`${formatPermissions(detailFor.permissions)} (0o${detailFor.permissions.toString(8)})`} />}
            {detailFor.modified != null && <DetailRow label="Modified" value={formatDate(detailFor.modified)} />}
          </div>
        </BottomSheet>
      )}
      {confirmBatchDelete && (
        <BottomSheet title={`Delete ${selected.length} item${selected.length === 1 ? "" : "s"}?`} onClose={() => setConfirmBatchDelete(false)}>
          <button data-sftp-batch-delete-go className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl" style={{ color: "var(--t-status-error)" }}
            onClick={() => void deleteSelected()}>
            <Icon icon="lucide:trash-2" width={18} /><span className="text-sm font-medium">Delete</span>
          </button>
          <button className="w-full px-3 py-3.5 rounded-xl text-sm text-(--t-text-dim)" onClick={() => setConfirmBatchDelete(false)}>Cancel</button>
        </BottomSheet>
      )}
      {creating && (
        <BottomSheet title="Create" onClose={() => setCreating(false)}>
          <SheetItem icon="lucide:folder-plus" label="New folder" onTap={() => { setCreating(false); setNewFolder(true); }} />
          <SheetItem icon="lucide:file-plus" label="New file" onTap={() => { setCreating(false); setNewFile(true); }} />
        </BottomSheet>
      )}
      {newFolder && (
        <BottomSheet title="New folder" onClose={() => setNewFolder(false)}>
          <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="Folder name"
            className="w-full rounded-xl px-3 h-11 text-sm outline-none text-(--t-text-primary) mb-2"
            style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }} />
          <button data-sftp-mkdir-go className="w-full px-3 py-3 rounded-xl text-sm font-medium" style={{ background: "var(--t-accent)", color: "#fff" }}
            onClick={async () => { const n = newFolderName.trim(); setNewFolder(false); setNewFolderName(""); if (n) try { await mkdir(n); } catch (e) { alert(String(e)); } }}>Create</button>
        </BottomSheet>
      )}
      {newFile && (
        <BottomSheet title="New file" onClose={() => setNewFile(false)}>
          <input autoFocus value={newFileName} onChange={(e) => setNewFileName(e.target.value)} placeholder="File name"
            className="w-full rounded-xl px-3 h-11 text-sm outline-none text-(--t-text-primary) mb-2"
            style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }} />
          <button data-sftp-touch-go className="w-full px-3 py-3 rounded-xl text-sm font-medium" style={{ background: "var(--t-accent)", color: "#fff" }}
            onClick={async () => { const n = newFileName.trim(); setNewFile(false); setNewFileName(""); if (n) try { await touch(n); } catch (e) { alert(String(e)); } }}>Create</button>
        </BottomSheet>
      )}
    </div>
  );
}

function FileRow({ file, checked, onTap, onToggle, onLong }: { file: FileEntry; checked: boolean; onTap: () => void; onToggle: () => void; onLong: () => void }) {
  const icon = file.isDir ? "lucide:folder" : file.isSymlink ? "lucide:link" : "lucide:file";
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => () => clear(), []);
  const startLong = () => { fired.current = false; clear(); timer.current = setTimeout(() => { fired.current = true; onLong(); }, 500); };
  return (
    <button data-sftp-row={file.path}
      onClick={() => { if (!fired.current) onTap(); fired.current = false; }}
      onContextMenu={(e) => { e.preventDefault(); fired.current = true; onLong(); }}
      onTouchStart={startLong} onTouchEnd={clear} onTouchMove={clear} onTouchCancel={clear}
      className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-(--t-bg-card) border-b"
      style={{ borderColor: "var(--t-border)", background: checked ? "var(--t-bg-card)" : undefined }}>
      <Icon icon={icon} width={20} className="text-(--t-text-dim) shrink-0" />
      <span className="flex flex-col min-w-0 flex-1">
        <span className="text-sm text-(--t-text-primary) truncate">{file.name}</span>
        {!file.isDir && <span className="text-[11px] text-(--t-text-dim)">{formatSize(file.size)}</span>}
      </span>
      {file.isDir ? (
        <span className="flex items-center gap-2 shrink-0">
          <span
            role="checkbox" aria-checked={checked} data-sftp-dirselect={file.path}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="p-1 -m-1">
            <Icon icon={checked ? "lucide:check-square" : "lucide:square"} width={16}
              style={{ color: checked ? "var(--t-accent)" : "var(--t-text-dim)" }} />
          </span>
          <Icon icon="lucide:chevron-right" width={16} className="text-(--t-text-dim)" />
        </span>
      ) : (
        <Icon icon={checked ? "lucide:check-square" : "lucide:square"} width={16} className="shrink-0"
          style={{ color: checked ? "var(--t-accent)" : "var(--t-text-dim)" }} />
      )}
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

function SheetItem({ icon, label, onTap, danger }: { icon: string; label: string; onTap: () => void; danger?: boolean }) {
  return (
    <button data-sftp-action={label.toLowerCase().replace(/\s+/g, "-")}
      className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left active:bg-(--t-bg-card)"
      style={{ color: danger ? "var(--t-status-error)" : "var(--t-text-primary)" }} onClick={onTap}>
      <Icon icon={icon} width={18} /><span className="text-sm font-medium">{label}</span>
    </button>
  );
}
