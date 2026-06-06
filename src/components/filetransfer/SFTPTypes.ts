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
