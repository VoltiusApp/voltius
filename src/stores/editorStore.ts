import { create } from "zustand";

export interface EditorDoc {
  id: string;
  kind: "file";
  sftpId: string;
  path: string;
  hostLabel: string;
  dirty: boolean;
  autoSave: boolean;
}
export interface DiffSide {
  sftpId: string;
  path: string;
  hostLabel: string;
}
export interface DiffDoc {
  id: string;
  kind: "diff";
  left: DiffSide;
  right: DiffSide;
}
export type EditorTab = EditorDoc | DiffDoc;

interface EditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
  openDoc(args: { sftpId: string; path: string; hostLabel: string; autoSave: boolean }): string;
  openDiff(left: DiffSide, right: DiffSide): string;
  closeTab(id: string): void;
  setActiveTab(id: string | null): void;
  setDirty(id: string, dirty: boolean): void;
  setDocAutoSave(id: string, autoSave: boolean): void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  openDoc: ({ sftpId, path, hostLabel, autoSave }) => {
    const existing = get().tabs.find(
      (t) => t.kind === "file" && t.sftpId === sftpId && t.path === path,
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const id = crypto.randomUUID();
    const doc: EditorDoc = { id, kind: "file", sftpId, path, hostLabel, dirty: false, autoSave };
    set((s) => ({ tabs: [...s.tabs, doc], activeTabId: id }));
    return id;
  },
  openDiff: (left, right) => {
    const id = crypto.randomUUID();
    const diff: DiffDoc = { id, kind: "diff", left, right };
    set((s) => ({ tabs: [...s.tabs, diff], activeTabId: id }));
    return id;
  },
  closeTab: (id) =>
    set((s) => ({
      tabs: s.tabs.filter((t) => t.id !== id),
      activeTabId: s.activeTabId === id ? null : s.activeTabId,
    })),
  setActiveTab: (id) => set({ activeTabId: id }),
  setDirty: (id, dirty) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && t.kind === "file" ? { ...t, dirty } : t)),
    })),
  setDocAutoSave: (id, autoSave) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && t.kind === "file" ? { ...t, autoSave } : t)),
    })),
}));
