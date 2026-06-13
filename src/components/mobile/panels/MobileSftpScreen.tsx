import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useSftpDir, breadcrumbs } from "@/services/useSftpDir";
import { formatSize, type FileEntry } from "@/components/filetransfer/SFTPTypes";
import MobilePanelHeader from "./MobilePanelHeader";

function isPermissionDenied(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("permission denied") || m.includes("eacces");
}

export default function MobileSftpScreen({ sessionId }: { sessionId: string }) {
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId));
  const connections = useAllConnections();
  const connection = useMemo(() => connections.find((c) => c.id === session?.connectionId), [connections, session?.connectionId]);
  const { phase, cwd, entries, listing, listError, navigate, goUp } = useSftpDir(connection);
  const [showHidden, setShowHidden] = useState(false);

  const visible = useMemo(() => {
    const filtered = showHidden ? entries : entries.filter((e) => !e.name.startsWith("."));
    return [...filtered].sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
  }, [entries, showHidden]);

  const header = (
    <MobilePanelHeader
      title="SFTP"
      sessionName={session?.connectionName}
      right={
        <button data-sftp-hidden onClick={() => setShowHidden((v) => !v)} className="px-2 py-1 text-xs rounded-lg"
          style={{ color: showHidden ? "var(--t-accent)" : "var(--t-text-dim)" }}>
          {showHidden ? "Hidden" : "Visible"}
        </button>
      }
    />
  );

  // not-connected (no SSH session backing the connection)
  if (!session || session.type !== "ssh" || !connection) {
    return (
      <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">{header}
        <div className="flex-1 flex items-center justify-center px-6 text-center text-sm text-(--t-text-dim)">
          SFTP needs an SSH host. Connect to a host to browse its files.
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      {header}
      {/* Breadcrumb */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-2 overflow-x-auto border-b" style={{ borderColor: "var(--t-border)" }}>
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
      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {phase.tag === "connecting" && (
          <div className="flex items-center justify-center pt-16 text-sm text-(--t-text-dim) gap-2">
            <Icon icon="lucide:loader-2" width={18} className="animate-spin" /> Connecting…
          </div>
        )}
        {phase.tag === "error" && (
          <div className="flex flex-col items-center gap-3 pt-16 px-6 text-center text-(--t-text-dim)">
            <Icon icon="lucide:wifi-off" width={26} className="text-(--t-status-error)" />
            <span className="text-sm text-(--t-status-error)">{phase.message}</span>
          </div>
        )}
        {phase.tag === "connected" && listError && (
          <div className="flex flex-col items-center gap-2 pt-16 px-6 text-center text-(--t-text-dim)">
            <Icon icon={isPermissionDenied(listError) ? "lucide:lock" : "lucide:triangle-alert"} width={26} />
            <span className="text-sm">{isPermissionDenied(listError) ? "Permission denied" : listError}</span>
            <button onClick={goUp} className="text-sm px-4 py-2 rounded-xl" style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}>Go up</button>
          </div>
        )}
        {phase.tag === "connected" && !listError && visible.length === 0 && !listing && (
          <div className="flex flex-col items-center gap-2 pt-16 text-(--t-text-dim)">
            <Icon icon="lucide:folder-open" width={26} /><span className="text-sm">Empty folder</span>
          </div>
        )}
        {phase.tag === "connected" && !listError && visible.map((f) => (
          <FileRow key={f.path} file={f} onTap={() => (f.isDir ? navigate(f.path) : void 0 /* actions sheet — Task 3 */)} />
        ))}
      </div>
    </div>
  );
}

function FileRow({ file, onTap }: { file: FileEntry; onTap: () => void }) {
  const icon = file.isDir ? "lucide:folder" : file.isSymlink ? "lucide:link" : "lucide:file";
  return (
    <button data-sftp-row={file.path} onClick={onTap}
      className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-(--t-bg-card) border-b" style={{ borderColor: "var(--t-border)" }}>
      <Icon icon={icon} width={20} className="text-(--t-text-dim) shrink-0" />
      <span className="flex flex-col min-w-0 flex-1">
        <span className="text-sm text-(--t-text-primary) truncate">{file.name}</span>
        {!file.isDir && <span className="text-[11px] text-(--t-text-dim)">{formatSize(file.size)}</span>}
      </span>
      {file.isDir && <Icon icon="lucide:chevron-right" width={16} className="text-(--t-text-dim) shrink-0" />}
    </button>
  );
}
