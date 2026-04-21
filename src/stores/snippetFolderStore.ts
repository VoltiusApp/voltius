import { create } from "zustand";
import type { Folder, FolderFormData } from "@/types";
import * as api from "@/services/snippets";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";

interface SnippetFolderStore {
  folders: Folder[];
  loading: boolean;
  loadFolders: () => Promise<void>;
  saveFolder: (data: FolderFormData) => Promise<Folder>;
  updateFolder: (id: string, data: FolderFormData) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveFolder: (id: string, parentFolderId: string | null) => Promise<void>;
}

export const useSnippetFolderStore = create<SnippetFolderStore>((set, get) => ({
  folders: [],
  loading: false,

  loadFolders: async () => {
    set({ loading: true });
    const folders = await api.listSnippetFolders();
    set({ folders, loading: false });
  },

  saveFolder: async (data) => {
    const folder = await api.createSnippetFolder(data);
    const folders = await api.listSnippetFolders();
    set({ folders });
    isServerMode().then((s) => { if (s) scheduleSync(); });
    return folder;
  },

  updateFolder: async (id, data) => {
    await api.updateSnippetFolder(id, data);
    const folders = await api.listSnippetFolders();
    set({ folders });
    isServerMode().then((s) => { if (s) scheduleSync(); });
  },

  deleteFolder: async (id) => {
    await api.deleteSnippetFolder(id);
    const folders = await api.listSnippetFolders();
    set({ folders });
    isServerMode().then((s) => { if (s) scheduleSync(); });
  },

  moveFolder: async (id, parentFolderId) => {
    const folder = get().folders.find((f) => f.id === id);
    if (!folder) return;
    await api.updateSnippetFolder(id, {
      name: folder.name,
      object_type: folder.object_type,
      parent_folder_id: parentFolderId ?? undefined,
    });
    const folders = await api.listSnippetFolders();
    set({ folders });
    isServerMode().then((s) => { if (s) scheduleSync(); });
  },
}));
