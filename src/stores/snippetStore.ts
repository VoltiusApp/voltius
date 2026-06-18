import { create } from "zustand";
import type { Snippet, SnippetFormData } from "@/types";
import type { SnippetPendingInject } from "@/services/snippetRunCore";
import * as api from "@/services/snippets";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { reportAuditMutation } from "@/services/auditMutations";
import { useHistoryStore } from "@/stores/historyStore";
import { useTeamStore } from "@/stores/teamStore";
import { removeTeamVaultObject, saveTeamVaultObject } from "@/services/teamObjectPersistence";
import { useTeamObjectPrefsStore } from "@/stores/teamObjectPrefsStore";
import { classifyVaultTransition, migrateVaultObject } from "@/services/teamVaultMigration";

function isTeamVaultId(vaultId: string | null | undefined): vaultId is string {
  if (!vaultId) return false;
  return useTeamStore.getState().teams.some((t) => t.id === vaultId);
}

function upsert(arr: Snippet[], item: Snippet): Snippet[] {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...arr, item];
  const next = [...arr];
  next[idx] = item;
  return next;
}

function findTeamEntry(
  teamMap: Record<string, Snippet[]>,
  id: string,
): { teamId: string; item: Snippet } | null {
  for (const [teamId, items] of Object.entries(teamMap)) {
    const item = items.find((x) => x.id === id);
    if (item) return { teamId, item };
  }
  return null;
}

export type GlobalPendingInject = SnippetPendingInject;

// In-memory recent injection tracking (not persisted — cosmetic only)
const MAX_RECENT = 5;
let _recentIds: string[] = [];

interface SnippetStore {
  snippets: Snippet[];
  loading: boolean;
  recentSnippetIds: string[];
  globalPendingInject: GlobalPendingInject | null;
  teamSnippets: Record<string, Snippet[]>;
  loadSnippets: () => Promise<void>;
  setTeamSnippets: (teamId: string, items: Snippet[]) => void;
  clearTeamSnippets: (teamId?: string) => void;
  createSnippet: (data: SnippetFormData) => Promise<Snippet>;
  updateSnippet: (id: string, data: SnippetFormData) => Promise<void>;
  deleteSnippet: (id: string) => Promise<void>;
  pinSnippet: (id: string, pinned: boolean | null) => Promise<void>;
  pinSnippetForTeam: (id: string, pinned: boolean) => Promise<void>;
  trackUsed: (id: string) => void;
  setGlobalPendingInject: (v: GlobalPendingInject | null) => void;
}

export const useSnippetStore = create<SnippetStore>((set, get) => ({
  snippets: [],
  loading: false,
  recentSnippetIds: [],
  globalPendingInject: null,
  teamSnippets: {},

  loadSnippets: async () => {
    set({ loading: true });
    const snippets = await api.listSnippets();
    set({ snippets, loading: false });
  },

  setTeamSnippets: (teamId, items) =>
    set((s) => ({ teamSnippets: { ...s.teamSnippets, [teamId]: items } })),

  clearTeamSnippets: (teamId) =>
    set((s) => {
      if (teamId === undefined) return { teamSnippets: {} };
      const next = { ...s.teamSnippets };
      delete next[teamId];
      return { teamSnippets: next };
    }),

  createSnippet: async (data) => {
    if (isTeamVaultId(data.vault_id)) {
      const now = new Date().toISOString();
      const snippet: Snippet = {
        id: crypto.randomUUID(),
        name: data.name,
        content: data.content,
        description: data.description,
        tags: data.tags ?? [],
        folder_id: data.folder_id,
        favorite: data.favorite ?? false,
        only_for_connection_tags: data.only_for_connection_tags ?? [],
        only_for_distros: data.only_for_distros ?? [],
        vault_id: data.vault_id!,
        created_at: now,
        updated_at: now,
        clocks: { created_at: now, updated_at: now },
      };
      const vaultId = data.vault_id!;
      await saveTeamVaultObject(vaultId, "snippet", snippet);
      set((s) => ({
        teamSnippets: {
          ...s.teamSnippets,
          [vaultId]: upsert(s.teamSnippets[vaultId] ?? [], snippet),
        },
      }));
      reportAuditMutation("snippet", "created", { id: snippet.id, name: snippet.name, vault_id: snippet.vault_id });
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
    }

    const snippet = await api.createSnippet(data);
    const snippets = await api.listSnippets();
    set({ snippets });
    isServerMode().then((s) => { if (s) scheduleSync(); });
    reportAuditMutation("snippet", "created", { id: snippet.id, name: snippet.name, vault_id: snippet.vault_id });
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
    const teamEntry = findTeamEntry(get().teamSnippets, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      const now = new Date().toISOString();
      const updated: Snippet = {
        ...prev,
        name: data.name,
        content: data.content,
        description: data.description,
        tags: data.tags ?? prev.tags,
        folder_id: data.folder_id,
        favorite: data.favorite ?? prev.favorite,
        only_for_connection_tags: data.only_for_connection_tags ?? prev.only_for_connection_tags,
        only_for_distros: data.only_for_distros ?? prev.only_for_distros,
        vault_id: data.vault_id ?? prev.vault_id,
        updated_at: now,
        clocks: { ...prev.clocks, updated_at: now },
      };
      const migrated = await migrateVaultObject({
        previousVaultId: teamId,
        nextVaultId: updated.vault_id,
        isTeamVaultId,
        item: updated,
        updateLocal: () => api.updateSnippet(id, data).then(() => updated),
        saveTeam: (tid, item) => saveTeamVaultObject(tid, "snippet", item),
        removeTeam: removeTeamVaultObject,
      });
      const transition = classifyVaultTransition(teamId, migrated.vault_id, isTeamVaultId);
      const localSnippets = transition.kind === "team-to-local" ? await api.listSnippets() : undefined;
      set((s) => {
        const nextTeamSnippets = { ...s.teamSnippets };
        if (transition.kind === "team-to-team") {
          nextTeamSnippets[transition.sourceTeamId] = (nextTeamSnippets[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
          nextTeamSnippets[transition.destinationTeamId] = upsert(nextTeamSnippets[transition.destinationTeamId] ?? [], migrated);
          return { teamSnippets: nextTeamSnippets };
        }
        if (transition.kind === "team-to-local") {
          nextTeamSnippets[transition.sourceTeamId] = (nextTeamSnippets[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
          return { snippets: localSnippets, teamSnippets: nextTeamSnippets };
        }
        nextTeamSnippets[teamId] = upsert(nextTeamSnippets[teamId] ?? [], migrated);
        return { teamSnippets: nextTeamSnippets };
      });
      reportAuditMutation("snippet", "updated", { id: migrated.id, name: migrated.name, vault_id: migrated.vault_id });
      const prevData: SnippetFormData = {
        name: prev.name, content: prev.content, description: prev.description,
        tags: prev.tags, folder_id: prev.folder_id, favorite: prev.favorite,
        only_for_connection_tags: prev.only_for_connection_tags,
        only_for_distros: prev.only_for_distros, vault_id: prev.vault_id,
      };
      useHistoryStore.getState().push({
        label: `Updated snippet "${prev.name}"`,
        undo: async () => { await useSnippetStore.getState().updateSnippet(id, prevData); },
        redo: async () => { await useSnippetStore.getState().updateSnippet(id, data); },
      });
      return;
    }

    const prev = (get().snippets as Snippet[]).find((s) => s.id === id);
    if (prev) {
      const nextVaultId = data.vault_id ?? prev.vault_id;
      await migrateVaultObject({
        previousVaultId: prev.vault_id,
        nextVaultId,
        isTeamVaultId,
        item: { ...prev, ...data, vault_id: nextVaultId, tags: data.tags ?? prev.tags },
        updateLocal: () => api.updateSnippet(id, data).then(() => ({ ...prev, ...data, vault_id: nextVaultId, tags: data.tags ?? prev.tags })),
        saveTeam: (teamId, item) => saveTeamVaultObject(teamId, "snippet", item),
        removeTeam: removeTeamVaultObject,
      });
    } else {
      await api.updateSnippet(id, data);
    }
    const snippets = await api.listSnippets();
    set((s) => {
      if (prev) {
        const nextVaultId = data.vault_id ?? prev.vault_id;
        const nextTeamSnippets = { ...s.teamSnippets };
        const transition = classifyVaultTransition(prev.vault_id, nextVaultId, isTeamVaultId);
        if (transition.kind === "local-to-team") {
          const item = { ...prev, ...data, vault_id: nextVaultId, tags: data.tags ?? prev.tags };
          nextTeamSnippets[transition.destinationTeamId] = upsert(nextTeamSnippets[transition.destinationTeamId] ?? [], item);
        } else if (transition.kind === "team-to-team") {
          nextTeamSnippets[transition.sourceTeamId] = (nextTeamSnippets[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
          const item = { ...prev, ...data, vault_id: nextVaultId, tags: data.tags ?? prev.tags };
          nextTeamSnippets[transition.destinationTeamId] = upsert(nextTeamSnippets[transition.destinationTeamId] ?? [], item);
        } else if (transition.kind === "team-to-local") {
          nextTeamSnippets[transition.sourceTeamId] = (nextTeamSnippets[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
        }
        return { snippets, teamSnippets: nextTeamSnippets };
      }
      return { snippets };
    });
    isServerMode().then((s) => { if (s) scheduleSync(); });
    if (prev) reportAuditMutation("snippet", "updated", { id, name: data.name ?? prev.name, vault_id: data.vault_id ?? prev.vault_id });
    if (prev) {
      const prevData: SnippetFormData = {
        name: prev.name, content: prev.content, description: prev.description,
        tags: prev.tags, folder_id: prev.folder_id, favorite: prev.favorite,
        only_for_connection_tags: prev.only_for_connection_tags,
        only_for_distros: prev.only_for_distros, vault_id: prev.vault_id,
      };
      useHistoryStore.getState().push({
        label: `Updated snippet "${prev.name}"`,
        undo: async () => { await useSnippetStore.getState().updateSnippet(id, prevData); },
        redo: async () => { await useSnippetStore.getState().updateSnippet(id, data); },
      });
    }
  },

  deleteSnippet: async (id) => {
    const teamEntry = findTeamEntry(get().teamSnippets, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      await removeTeamVaultObject(teamId, id);
      set((s) => ({
        teamSnippets: {
          ...s.teamSnippets,
          [teamId]: (s.teamSnippets[teamId] ?? []).filter((x) => x.id !== id),
        },
      }));
      reportAuditMutation("snippet", "deleted", { id: prev.id, name: prev.name, vault_id: prev.vault_id });
      const prevData: SnippetFormData = {
        name: prev.name, content: prev.content, description: prev.description,
        tags: prev.tags, folder_id: prev.folder_id, favorite: prev.favorite,
        only_for_connection_tags: prev.only_for_connection_tags,
        only_for_distros: prev.only_for_distros, vault_id: prev.vault_id,
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
      return;
    }

    const prev = (get().snippets as Snippet[]).find((s) => s.id === id);
    await api.deleteSnippet(id);
    const snippets = await api.listSnippets();
    set({ snippets });
    isServerMode().then((s) => { if (s) scheduleSync(); });
    if (prev) reportAuditMutation("snippet", "deleted", { id: prev.id, name: prev.name, vault_id: prev.vault_id });
    if (prev) {
      const prevData: SnippetFormData = {
        name: prev.name, content: prev.content, description: prev.description,
        tags: prev.tags, folder_id: prev.folder_id, favorite: prev.favorite,
        only_for_connection_tags: prev.only_for_connection_tags,
        only_for_distros: prev.only_for_distros, vault_id: prev.vault_id,
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
    const teamEntry = findTeamEntry(get().teamSnippets, id);
    if (teamEntry) {
      await useTeamObjectPrefsStore.getState().setPinned(teamEntry.teamId, id, pinned);
      return;
    }

    const snippet = (get().snippets as Snippet[]).find((s) => s.id === id);
    if (!snippet) return;
    const nextFavorite = pinned ?? false;
    await api.updateSnippet(id, {
      name: snippet.name, content: snippet.content, description: snippet.description,
      tags: snippet.tags, folder_id: snippet.folder_id, favorite: nextFavorite,
      only_for_connection_tags: snippet.only_for_connection_tags,
      only_for_distros: snippet.only_for_distros, vault_id: snippet.vault_id,
    });
    set((s) => ({ snippets: (s.snippets as Snippet[]).map((sn) => sn.id === id ? { ...sn, favorite: nextFavorite } : sn) }));
    isServerMode().then((s) => { if (s) scheduleSync(); });
  },

  pinSnippetForTeam: async (id, pinned) => {
    const teamEntry = findTeamEntry(get().teamSnippets, id);
    if (!teamEntry) return;
    const { teamId, item: snippet } = teamEntry;
    const now = new Date().toISOString();
    const updated: Snippet = { ...snippet, favorite: pinned, updated_at: now, clocks: { ...snippet.clocks, updated_at: now } };
    await saveTeamVaultObject(teamId, "snippet", updated);
    set((s) => ({
      teamSnippets: {
        ...s.teamSnippets,
        [teamId]: upsert(s.teamSnippets[teamId] ?? [], updated),
      },
    }));
  },

  trackUsed: (id) => {
    _recentIds = [id, ..._recentIds.filter((x) => x !== id)].slice(0, MAX_RECENT);
    set({ recentSnippetIds: [..._recentIds] });
  },

  setGlobalPendingInject: (v) => set({ globalPendingInject: v }),
}));
