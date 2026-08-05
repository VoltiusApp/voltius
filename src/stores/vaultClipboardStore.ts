import { create } from "zustand";
import type { NavItem } from "@/stores/uiStore";

export type VaultClipboardKind =
  | "connection"
  | "identity"
  | "key"
  | "port_forward"
  | "snippet";

export interface VaultClipboardEntry {
  id: string;
  kind: VaultClipboardKind;
}

export type VaultClipboard = {
  tab: NavItem;
  mode: "copy" | "cut";
  items: VaultClipboardEntry[];
  folderIds: string[];
  sourceVaultIds: string[];
} | null;

interface VaultClipboardStore {
  clipboard: VaultClipboard;
  setClipboard: (c: VaultClipboard) => void;
  clear: () => void;
}

// Deliberately not persisted: ids in a restored clipboard may no longer exist.
export const useVaultClipboardStore = create<VaultClipboardStore>((set) => ({
  clipboard: null,
  setClipboard: (c) => set({ clipboard: c }),
  clear: () => set({ clipboard: null }),
}));
