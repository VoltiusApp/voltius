import { invoke } from "@tauri-apps/api/core";
import type { Snippet, SnippetFormData, Folder, FolderFormData } from "@/types";
import { getPaneSessionIds, useLayoutStore } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";

// ─── Snippets ─────────────────────────────────────────────────────────────────

export async function listSnippets(): Promise<Snippet[]> {
  return invoke("snippet_list");
}

export async function createSnippet(data: SnippetFormData): Promise<Snippet> {
  return invoke("snippet_create", { data });
}

export async function updateSnippet(id: string, data: SnippetFormData): Promise<Snippet> {
  return invoke("snippet_update", { id, data });
}

export async function deleteSnippet(id: string): Promise<void> {
  return invoke("snippet_delete", { id });
}

export async function snippetInject(
  sessionId: string,
  sessionType: string,
  text: string,
  execute: boolean,
): Promise<void> {
  return invoke("snippet_inject", { sessionId, sessionType, text, execute });
}

export async function broadcastSnippetInject(
  activeSessionId: string,
  activeSessionType: string,
  text: string,
  execute: boolean,
): Promise<void> {
  const layout = useLayoutStore.getState();
  const paneSessionIds = getPaneSessionIds(layout.root);

  if (layout.broadcastActive && layout.splitTabActive && paneSessionIds.includes(activeSessionId)) {
    const sessions = useSessionStore.getState().sessions;
    const mpConnections = useTeamSessionStore.getState().connections;
    const injects: Promise<void>[] = [];
    for (const targetId of paneSessionIds) {
      const target = sessions.find((s) => s.id === targetId);
      if (!target || target.status !== "connected" || target.type === "multiplayer") continue;
      const mpState = mpConnections[target.id];
      if (mpState && mpState.controlHolder !== "" && mpState.controlHolder !== mpState.myUserId) continue;
      injects.push(snippetInject(target.id, target.type, text, execute));
    }
    await Promise.all(injects);
    return;
  }

  return snippetInject(activeSessionId, activeSessionType, text, execute);
}

// ─── Snippet folders ──────────────────────────────────────────────────────────
// The Rust backend stores snippet folders with `parent_id`; we normalise to
// `parent_folder_id` at this layer so the rest of the app uses one unified type.

type RawSnippetFolder = Omit<Folder, "parent_folder_id" | "object_type"> & {
  parent_id?: string;
};

type RawSnippetFolderFormData = Omit<FolderFormData, "parent_folder_id" | "object_type"> & {
  parent_id?: string;
};

function fromRaw(raw: RawSnippetFolder): Folder {
  const { parent_id, ...rest } = raw;
  return { ...rest, object_type: "snippet", parent_folder_id: parent_id };
}

function toRaw(data: FolderFormData): RawSnippetFolderFormData {
  const { parent_folder_id, object_type: _ot, ...rest } = data;
  return { ...rest, parent_id: parent_folder_id };
}

export async function listSnippetFolders(): Promise<Folder[]> {
  const raw: RawSnippetFolder[] = await invoke("snippet_folder_list");
  return raw.map(fromRaw);
}

export async function createSnippetFolder(data: FolderFormData): Promise<Folder> {
  const raw: RawSnippetFolder = await invoke("snippet_folder_create", { data: toRaw(data) });
  return fromRaw(raw);
}

export async function updateSnippetFolder(id: string, data: FolderFormData): Promise<Folder> {
  const raw: RawSnippetFolder = await invoke("snippet_folder_update", { id, data: toRaw(data) });
  return fromRaw(raw);
}

/** Cascades to subfolders and every snippet filed in them. */
export async function deleteSnippetFolder(id: string): Promise<void> {
  return invoke("snippet_folder_delete", { id });
}
