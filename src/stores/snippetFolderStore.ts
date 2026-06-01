import { create } from "zustand";
import type { Folder, FolderFormData } from "@/types";
import * as api from "@/services/snippets";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { removeTeamVaultObject, saveTeamVaultObject } from "@/services/teamObjectPersistence";
import { classifyVaultTransition, migrateVaultObject } from "@/services/teamVaultMigration";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamObjectPrefsStore } from "@/stores/teamObjectPrefsStore";

function isTeamVaultId(vaultId: string | null | undefined): vaultId is string {
  if (!vaultId) return false;
  return useTeamStore.getState().teams.some((t) => t.id === vaultId);
}

function upsert(arr: Folder[], item: Folder): Folder[] {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...arr, item];
  const next = [...arr];
  next[idx] = item;
  return next;
}

function findTeamEntry(
  teamMap: Record<string, Folder[]>,
  id: string,
): { teamId: string; item: Folder } | null {
  for (const [teamId, items] of Object.entries(teamMap)) {
    const item = items.find((x) => x.id === id);
    if (item) return { teamId, item };
  }
  return null;
}

interface SnippetFolderStore {
  folders: Folder[];
  loading: boolean;
  teamSnippetFolders: Record<string, Folder[]>;
  loadFolders: () => Promise<void>;
  setTeamSnippetFolders: (teamId: string, items: Folder[]) => void;
  clearTeamSnippetFolders: (teamId?: string) => void;
  saveFolder: (data: FolderFormData) => Promise<Folder>;
  updateFolder: (id: string, data: FolderFormData) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveFolder: (id: string, parentFolderId: string | null) => Promise<void>;
  pinSnippetFolder: (id: string, pinned: boolean | null) => Promise<void>;
  pinSnippetFolderForTeam: (id: string, pinned: boolean) => Promise<void>;
}

export const useSnippetFolderStore = create<SnippetFolderStore>((set, get) => ({
  folders: [],
  loading: false,
  teamSnippetFolders: {},

  loadFolders: async () => {
    set({ loading: true });
    const folders = await api.listSnippetFolders();
    set({ folders, loading: false });
  },

  setTeamSnippetFolders: (teamId, items) =>
    set((s) => ({ teamSnippetFolders: { ...s.teamSnippetFolders, [teamId]: items } })),

  clearTeamSnippetFolders: (teamId) =>
    set((s) => {
      if (teamId === undefined) return { teamSnippetFolders: {} };
      const next = { ...s.teamSnippetFolders };
      delete next[teamId];
      return { teamSnippetFolders: next };
    }),

  saveFolder: async (data) => {
    if (data.vault_id) {
      const { useTeamStore } = await import("@/stores/teamStore");
      if (useTeamStore.getState().teams.some((t) => t.id === data.vault_id)) {
        const now = new Date().toISOString();
        const folder: Folder = {
          id: crypto.randomUUID(),
          name: data.name,
          object_type: data.object_type,
          parent_folder_id: data.parent_folder_id,
          vault_id: data.vault_id,
          created_at: now,
          updated_at: now,
          clocks: { created_at: now, updated_at: now },
        };
        const vaultId = data.vault_id;
        await saveTeamVaultObject(vaultId, "snippet_folder", folder);
        set((s) => ({
          teamSnippetFolders: {
            ...s.teamSnippetFolders,
            [vaultId]: upsert(s.teamSnippetFolders[vaultId] ?? [], folder),
          },
        }));
        return folder;
      }
    }

    const folder = await api.createSnippetFolder(data);
    const folders = await api.listSnippetFolders();
    set({ folders });
    isServerMode().then((s) => { if (s) scheduleSync(); });
    return folder;
  },

  updateFolder: async (id, data) => {
    const teamEntry = findTeamEntry(get().teamSnippetFolders, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      const now = new Date().toISOString();
      const updated: Folder = {
        ...prev,
        name: data.name,
        object_type: data.object_type,
        parent_folder_id: data.parent_folder_id,
        vault_id: data.vault_id ?? prev.vault_id,
        updated_at: now,
        clocks: { ...prev.clocks, updated_at: now },
      };
      const migrated = await migrateVaultObject({
        previousVaultId: teamId,
        nextVaultId: updated.vault_id,
        isTeamVaultId,
        item: updated,
        updateLocal: () => api.updateSnippetFolder(id, data).then(() => updated),
        saveTeam: (tid, item) => saveTeamVaultObject(tid, "snippet_folder", item),
        removeTeam: removeTeamVaultObject,
      });
      const transition = classifyVaultTransition(teamId, migrated.vault_id, isTeamVaultId);
      const localFolders = transition.kind === "team-to-local" ? await api.listSnippetFolders() : undefined;
      set((s) => {
        const nextTeamSnippetFolders = { ...s.teamSnippetFolders };
        if (transition.kind === "team-to-team") {
          nextTeamSnippetFolders[transition.sourceTeamId] = (nextTeamSnippetFolders[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
          nextTeamSnippetFolders[transition.destinationTeamId] = upsert(nextTeamSnippetFolders[transition.destinationTeamId] ?? [], migrated);
          return { teamSnippetFolders: nextTeamSnippetFolders };
        }
        if (transition.kind === "team-to-local") {
          nextTeamSnippetFolders[transition.sourceTeamId] = (nextTeamSnippetFolders[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
          return { folders: localFolders, teamSnippetFolders: nextTeamSnippetFolders };
        }
        nextTeamSnippetFolders[teamId] = upsert(nextTeamSnippetFolders[teamId] ?? [], migrated);
        return { teamSnippetFolders: nextTeamSnippetFolders };
      });
      return;
    }

    const prev = get().folders.find((f) => f.id === id);
    let updatedLocal: Folder | undefined;
    if (prev) {
      const nextVaultId = data.vault_id ?? prev.vault_id;
      updatedLocal = await migrateVaultObject<Folder>({
        previousVaultId: prev.vault_id,
        nextVaultId,
        isTeamVaultId,
        item: { ...prev, ...data, vault_id: nextVaultId } as Folder,
        updateLocal: () => api.updateSnippetFolder(id, data).then(() => ({ ...prev, ...data, vault_id: nextVaultId } as Folder)),
        saveTeam: (teamId, item) => saveTeamVaultObject(teamId, "snippet_folder", item),
        removeTeam: removeTeamVaultObject,
      });
    } else {
      await api.updateSnippetFolder(id, data);
    }
    const folders = await api.listSnippetFolders();
    set((s) => {
      const nextTeamSnippetFolders = { ...s.teamSnippetFolders };
      if (prev && updatedLocal) {
        const transition = classifyVaultTransition(prev.vault_id, updatedLocal.vault_id, isTeamVaultId);
        if (transition.kind === "local-to-team") {
          nextTeamSnippetFolders[transition.destinationTeamId] = upsert(nextTeamSnippetFolders[transition.destinationTeamId] ?? [], updatedLocal);
        } else if (transition.kind === "team-to-team") {
          nextTeamSnippetFolders[transition.sourceTeamId] = (nextTeamSnippetFolders[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
          nextTeamSnippetFolders[transition.destinationTeamId] = upsert(nextTeamSnippetFolders[transition.destinationTeamId] ?? [], updatedLocal);
        } else if (transition.kind === "team-to-local") {
          nextTeamSnippetFolders[transition.sourceTeamId] = (nextTeamSnippetFolders[transition.sourceTeamId] ?? []).filter((x) => x.id !== id);
        }
      }
      return { folders, teamSnippetFolders: nextTeamSnippetFolders };
    });
    isServerMode().then((s) => { if (s) scheduleSync(); });
  },

  deleteFolder: async (id) => {
    const teamEntry = findTeamEntry(get().teamSnippetFolders, id);
    if (teamEntry) {
      const { teamId } = teamEntry;
      await removeTeamVaultObject(teamId, id);
      set((s) => ({
        teamSnippetFolders: {
          ...s.teamSnippetFolders,
          [teamId]: (s.teamSnippetFolders[teamId] ?? []).filter((x) => x.id !== id),
        },
      }));
      return;
    }

    await api.deleteSnippetFolder(id);
    const folders = await api.listSnippetFolders();
    set({ folders });
    isServerMode().then((s) => { if (s) scheduleSync(); });
  },

  moveFolder: async (id, parentFolderId) => {
    const teamEntry = findTeamEntry(get().teamSnippetFolders, id);
    if (teamEntry) {
      const { teamId, item: folder } = teamEntry;
      const now = new Date().toISOString();
      const updated: Folder = {
        ...folder,
        parent_folder_id: parentFolderId ?? undefined,
        updated_at: now,
        clocks: { ...folder.clocks, updated_at: now },
      };
      await saveTeamVaultObject(teamId, "snippet_folder", updated);
      set((s) => ({
        teamSnippetFolders: {
          ...s.teamSnippetFolders,
          [teamId]: upsert(s.teamSnippetFolders[teamId] ?? [], updated),
        },
      }));
      return;
    }

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

  pinSnippetFolder: async (id, pinned) => {
    const teamEntry = findTeamEntry(get().teamSnippetFolders, id);
    if (teamEntry) {
      await useTeamObjectPrefsStore.getState().setPinned(teamEntry.teamId, id, pinned);
      return;
    }

    const folder = get().folders.find((f) => f.id === id);
    if (!folder) return;
    const nextPinned = pinned ?? false;
    await api.updateSnippetFolder(id, {
      name: folder.name,
      object_type: folder.object_type,
      parent_folder_id: folder.parent_folder_id,
      pinned: nextPinned,
    });
    set((s) => ({ folders: s.folders.map((f) => f.id === id ? { ...f, pinned: nextPinned } : f) }));
    isServerMode().then((s) => { if (s) scheduleSync(); });
  },

  pinSnippetFolderForTeam: async (id, pinned) => {
    const teamEntry = findTeamEntry(get().teamSnippetFolders, id);
    if (!teamEntry) return;
    const { teamId, item: prev } = teamEntry;
    const now = new Date().toISOString();
    const updated: Folder = { ...prev, pinned, updated_at: now, clocks: { ...prev.clocks, updated_at: now } };
    await saveTeamVaultObject(teamId, "snippet_folder", updated);
    set((s) => ({
      teamSnippetFolders: {
        ...s.teamSnippetFolders,
        [teamId]: upsert(s.teamSnippetFolders[teamId] ?? [], updated),
      },
    }));
  },
}));
