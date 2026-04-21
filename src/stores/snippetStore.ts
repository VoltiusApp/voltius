import { create } from "zustand";
import type { Snippet, SnippetFormData } from "@/types";
import type { ParsedVariable } from "@/services/snippetParser";
import * as api from "@/services/snippets";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { useHistoryStore } from "@/stores/historyStore";

export interface GlobalPendingInject {
  snippet: Snippet;
  userVars: ParsedVariable[];
  partialTemplate: string;
  initialValues: Record<string, string>;
}

// In-memory recent injection tracking (not persisted — cosmetic only)
const MAX_RECENT = 5;
let _recentIds: string[] = [];

interface SnippetStore {
  snippets: Snippet[];
  loading: boolean;
  recentSnippetIds: string[];
  globalPendingInject: GlobalPendingInject | null;
  loadSnippets: () => Promise<void>;
  createSnippet: (data: SnippetFormData) => Promise<Snippet>;
  updateSnippet: (id: string, data: SnippetFormData) => Promise<void>;
  deleteSnippet: (id: string) => Promise<void>;
  pinSnippet: (id: string, pinned: boolean) => Promise<void>;
  trackUsed: (id: string) => void;
  setGlobalPendingInject: (v: GlobalPendingInject | null) => void;
}

export const useSnippetStore = create<SnippetStore>((set) => ({
  snippets: [],
  loading: false,
  recentSnippetIds: [],
  globalPendingInject: null,

  loadSnippets: async () => {
    set({ loading: true });
    const snippets = await api.listSnippets();
    set({ snippets, loading: false });
  },

  createSnippet: async (data) => {
    const snippet = await api.createSnippet(data);
    const snippets = await api.listSnippets();
    set({ snippets });
    isServerMode().then((s) => { if (s) scheduleSync(); });
    let recreatedId: string | null = null;
    useHistoryStore.getState().push({
      label: `Created snippet "${snippet.name}"`,
      undo: async () => {
        await useSnippetStore.getState().deleteSnippet(recreatedId ?? snippet.id);
        recreatedId = null;
      },
      redo: async () => {
        const r = await useSnippetStore.getState().createSnippet(data);
        recreatedId = r.id;
      },
    });
    return snippet;
  },

  updateSnippet: async (id, data) => {
    const prev = (useSnippetStore.getState().snippets as Snippet[]).find((s) => s.id === id);
    await api.updateSnippet(id, data);
    const snippets = await api.listSnippets();
    set({ snippets });
    isServerMode().then((s) => { if (s) scheduleSync(); });
    if (prev) {
      const prevData: SnippetFormData = {
        name: prev.name,
        content: prev.content,
        description: prev.description,
        tags: prev.tags,
        folder_id: prev.folder_id,
        favorite: prev.favorite,
        only_for_connection_tags: prev.only_for_connection_tags,
        only_for_distros: prev.only_for_distros,
        vault_id: prev.vault_id,
      };
      useHistoryStore.getState().push({
        label: `Updated snippet "${prev.name}"`,
        undo: async () => { await useSnippetStore.getState().updateSnippet(id, prevData); },
        redo: async () => { await useSnippetStore.getState().updateSnippet(id, data); },
      });
    }
  },

  deleteSnippet: async (id) => {
    const prev = (useSnippetStore.getState().snippets as Snippet[]).find((s) => s.id === id);
    await api.deleteSnippet(id);
    const snippets = await api.listSnippets();
    set({ snippets });
    isServerMode().then((s) => { if (s) scheduleSync(); });
    if (prev) {
      const prevData: SnippetFormData = {
        name: prev.name,
        content: prev.content,
        description: prev.description,
        tags: prev.tags,
        folder_id: prev.folder_id,
        favorite: prev.favorite,
        only_for_connection_tags: prev.only_for_connection_tags,
        only_for_distros: prev.only_for_distros,
        vault_id: prev.vault_id,
      };
      let recreatedId: string | null = null;
      useHistoryStore.getState().push({
        label: `Deleted snippet "${prev.name}"`,
        undo: async () => {
          const r = await useSnippetStore.getState().createSnippet(prevData);
          recreatedId = r.id;
        },
        redo: async () => {
          await useSnippetStore.getState().deleteSnippet(recreatedId ?? id);
          recreatedId = null;
        },
      });
    }
  },

  pinSnippet: async (id, pinned) => {
    const snippet = (useSnippetStore.getState().snippets as Snippet[]).find((s) => s.id === id);
    if (!snippet) return;
    await api.updateSnippet(id, {
      name: snippet.name, content: snippet.content, description: snippet.description,
      tags: snippet.tags, folder_id: snippet.folder_id, favorite: pinned,
      only_for_connection_tags: snippet.only_for_connection_tags,
      only_for_distros: snippet.only_for_distros, vault_id: snippet.vault_id,
    });
    set((s) => ({ snippets: (s.snippets as Snippet[]).map((sn) => sn.id === id ? { ...sn, favorite: pinned } : sn) }));
    isServerMode().then((s) => { if (s) scheduleSync(); });
  },

  trackUsed: (id) => {
    _recentIds = [id, ..._recentIds.filter((x) => x !== id)].slice(0, MAX_RECENT);
    set({ recentSnippetIds: [..._recentIds] });
  },

  setGlobalPendingInject: (v) => set({ globalPendingInject: v }),
}));
