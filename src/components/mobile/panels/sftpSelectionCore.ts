import type { FileEntry } from "@/components/filetransfer/SFTPTypes";
import type { MyDevice } from "@/services/myDevices";
import { allKeysSelected, pruneKeys, toggleAllKeys, toggleKey } from "../selectionCore";

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

const path = (f: FileEntry) => f.path;

export const toggleItem = (items: FileEntry[], f: FileEntry): FileEntry[] => toggleKey(items, f, path);
export const toggleAll = (items: FileEntry[], visible: FileEntry[]): FileEntry[] => toggleAllKeys(items, visible, path);
export const allSelected = (items: FileEntry[], visible: FileEntry[]): boolean => allKeysSelected(items, visible, path);
export const pruneSelection = (items: FileEntry[], entries: FileEntry[]): FileEntry[] => pruneKeys(items, entries, path);
