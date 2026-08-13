import type { HostChoice } from "@/components/shared/HostPickerPanel";
import type { McpOwner } from "@/stores/mcpOwnershipStore";
export type { HostChoice };

export type FileEntry = {
  name: string; path: string; size: number; isDir: boolean;
  modified?: number; permissions?: number; isSymlink?: boolean;
};

export type SortCol = "name" | "size" | "modified" | "permissions";
export type SortDir = "asc" | "desc";

export type VisibleCols = { size: boolean; modified: boolean; permissions: boolean };
export const DEFAULT_VISIBLE_COLS: VisibleCols = { size: true, modified: true, permissions: true };

export type ColumnWidths = { name: number; size: number; modified: number; permissions: number };
export type FileColumn = keyof ColumnWidths;

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = { name: 260, size: 72, modified: 128, permissions: 88 };
export const COLUMN_MIN_WIDTHS: ColumnWidths = { name: 120, size: 56, modified: 96, permissions: 72 };

/** Gap between columns, in px — must match the `gap-2` on the header and row grids. */
const COLUMN_GAP = 8;

export function visibleDataColumns(isLocal: boolean, visibleCols: VisibleCols): FileColumn[] {
  return (["size", "modified", ...(!isLocal ? ["permissions"] : [])] as FileColumn[])
    .filter((col) => visibleCols[col as keyof VisibleCols]);
}

/** The single source of truth for the column geometry: the header row and every
 *  file row lay themselves out from this same grid template, so they cannot
 *  drift apart. `minWidth` is what makes the pane scroll horizontally instead of
 *  clipping the right-hand columns (and their resize handles) out of reach. */
export function columnGrid(isLocal: boolean, visibleCols: VisibleCols, colWidths: ColumnWidths): { template: string; minWidth: number } {
  const dataColumns = visibleDataColumns(isLocal, visibleCols);
  const template = [`minmax(${colWidths.name}px, 1fr)`, ...dataColumns.map((col) => `${colWidths[col]}px`)].join(" ");
  const minWidth = dataColumns.reduce((sum, col) => sum + colWidths[col] + COLUMN_GAP, colWidths.name);
  return { template, minWidth };
}

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
  /** Set when an MCP client started this transfer; absent for the user's own.
   *  Deliberately NOT mcpOwnershipStore: that store's keepOnly() reaper filters
   *  its records against live SESSION ids and would sweep every transfer, and
   *  the two differ in kind — session ownership is claimed, released and reaped,
   *  transfer ownership is a birth attribute on a self-expiring capped list. */
  owner?: McpOwner;
  /** Everything needed to run this transfer again. Never leaves the app: it
   *  holds a closure, so it is not projected over any API. */
  rerun?: { fn: (transferId: string) => Promise<void>; onDone?: () => void };
  /** True once runTransfer's finally has run. A cancelled/errored row is not
   *  retryable until it settles — otherwise a retry issued right after a
   *  cancel can start writing the destination while the cancelled transfer
   *  is still flushing. Internal, like `rerun`: never projected over any API. */
  settled?: boolean;
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
