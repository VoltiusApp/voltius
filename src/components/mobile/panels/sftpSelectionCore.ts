import type { FileEntry } from "@/components/filetransfer/SFTPTypes";
import type { MyDevice } from "@/services/myDevices";

/**
 * SFTP selection mode (pure, see MobileSftpScreen / MobileSftpPane). One pane at a time
 * owns the selection; an empty selection means selection mode is off.
 */
export type SftpPaneId = "a" | "b";

export type SftpPaneTarget = { kind: "connection"; id: string } | { kind: "device"; device: MyDevice };

export interface SftpSelection {
  pane: SftpPaneId | null;
  items: FileEntry[];
}

export const NO_SELECTION: SftpSelection = { pane: null, items: [] };

/** The selection after `pane` reports `items`: taking it over from the other pane, or ending it when empty. */
export function setPaneSelection(pane: SftpPaneId, items: FileEntry[]): SftpSelection {
  return items.length > 0 ? { pane, items } : NO_SELECTION;
}

/** What `pane` has selected (nothing when the other pane owns the selection). */
export function paneItems(sel: SftpSelection, pane: SftpPaneId): FileEntry[] {
  return sel.pane === pane ? sel.items : [];
}

/** Add or remove `f` (by path). */
export function toggleItem(items: FileEntry[], f: FileEntry): FileEntry[] {
  return items.some((x) => x.path === f.path) ? items.filter((x) => x.path !== f.path) : [...items, f];
}

/** Select every visible entry, or none when they all are already. */
export function toggleAll(items: FileEntry[], visible: FileEntry[]): FileEntry[] {
  return allSelected(items, visible) ? [] : visible;
}

export function allSelected(items: FileEntry[], visible: FileEntry[]): boolean {
  if (visible.length === 0) return false;
  const have = new Set(items.map((x) => x.path));
  return visible.every((v) => have.has(v.path));
}

/** Drop selected entries the listing no longer has (deleted, renamed, refreshed away). Same array when nothing changed. */
export function pruneSelection(items: FileEntry[], entries: FileEntry[]): FileEntry[] {
  const present = new Set(entries.map((e) => e.path));
  const kept = items.filter((x) => present.has(x.path));
  return kept.length === items.length ? items : kept;
}
