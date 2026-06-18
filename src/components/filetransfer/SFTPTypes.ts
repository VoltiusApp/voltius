import type { HostChoice } from "@/components/shared/HostPickerPanel";
export type { HostChoice };

export type FileEntry = {
  name: string; path: string; size: number; isDir: boolean;
  modified?: number; permissions?: number; isSymlink?: boolean;
};

export type SortCol = "name" | "size" | "modified" | "permissions";
export type SortDir = "asc" | "desc";

export type VisibleCols = { size: boolean; modified: boolean; permissions: boolean };

export type SidePhase =
  | { tag: "picking" }
  | { tag: "connecting"; connectId: string; host: HostChoice }
  | { tag: "connected"; sftpId: string | null; cwd: string; selected: FileEntry[] }
  | { tag: "error"; message: string; host?: HostChoice };

export type Transfer = {
  id: string; label: string; direction: "→" | "←";
  transferred: number; total: number;
  speed?: number;   // bytes/sec
  eta?: number;     // seconds remaining
  status: "running" | "done" | "cancelled" | "error"; error?: string;
  accelerated?: boolean; // ran via tar acceleration
};

export type ConflictResolution = "overwrite" | "overwrite-all" | "skip" | "skip-all" | "cancel";

let _tid = 0;
export const genId = () => `t-${Date.now()}-${_tid++}`;

export function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

/** Running-transfer meta line: "{transferred} / {total} · {speed}/s · {eta}".
 *  Speed/ETA segments are omitted when unknown. Shared by the desktop queue and
 *  the mobile transfer row so both render identical text. */
export function formatTransferProgress(t: Transfer): string {
  const progress = t.total > 0 ? `${formatSize(t.transferred)} / ${formatSize(t.total)}` : formatSize(t.transferred);
  const speed = t.speed != null ? ` · ${formatSize(Math.round(t.speed))}/s` : "";
  const eta = t.eta != null && t.eta > 0 ? ` · ${t.eta < 60 ? `${t.eta}s` : `${Math.round(t.eta / 60)}m`}` : "";
  return `${progress}${speed}${eta}`;
}

export function formatPermissions(mode: number): string {
  const b = (mask: number) => (mode & mask) ? 1 : 0;
  return (
    (b(0o400) ? "r" : "-") + (b(0o200) ? "w" : "-") + (b(0o100) ? "x" : "-") +
    (b(0o040) ? "r" : "-") + (b(0o020) ? "w" : "-") + (b(0o010) ? "x" : "-") +
    (b(0o004) ? "r" : "-") + (b(0o002) ? "w" : "-") + (b(0o001) ? "x" : "-")
  );
}

export function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mon = months[d.getMonth()];
  const day = String(d.getDate()).padStart(2, " ");
  if (d.getFullYear() === now.getFullYear()) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${mon} ${day} ${hh}:${mm}`;
  }
  return `${mon} ${day} ${d.getFullYear()}`;
}
