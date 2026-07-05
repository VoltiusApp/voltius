import { create } from "zustand";
import type { FileEntry } from "@/components/filetransfer/SFTPTypes";

export type FileEndpoint = { isLocal: boolean; sftpId: string | null; cwd: string };

export type FileClipboard = {
  items: FileEntry[];
  source: FileEndpoint;
  mode: "copy" | "cut";
} | null;

interface FileClipboardStore {
  clipboard: FileClipboard;
  set: (c: FileClipboard) => void;
  clear: () => void;
}

export const useFileClipboardStore = create<FileClipboardStore>((set) => ({
  clipboard: null,
  set: (c) => set({ clipboard: c }),
  clear: () => set({ clipboard: null }),
}));

export function sameHost(a: FileEndpoint, b: FileEndpoint): boolean {
  return a.isLocal === b.isLocal && a.sftpId === b.sftpId;
}
