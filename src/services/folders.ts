import { invoke } from "@tauri-apps/api/core";
import type { Folder, FolderFormData } from "@/types";

export async function listFolders(): Promise<Folder[]> {
  return invoke("folder_list");
}

export async function saveFolder(data: FolderFormData): Promise<Folder> {
  return invoke("folder_save", { data });
}

export async function updateFolder(id: string, data: FolderFormData): Promise<Folder> {
  return invoke("folder_update", { id, data });
}

/** Migration-only: re-creates a team-vault folder locally under its own id. */
export async function adoptFolder(id: string, data: FolderFormData): Promise<Folder> {
  return invoke("folder_adopt", { id, data });
}

/** Cascades to subfolders and their items unless `cascade` is false. */
export async function deleteFolder(id: string, cascade = true): Promise<void> {
  return invoke("folder_delete", { id, cascade });
}

export async function moveObjectsToFolder(
  objectIds: string[],
  objectType: "connection" | "identity" | "key",
  folderId: string | null,
): Promise<void> {
  return invoke("folder_move_objects", { objectIds, objectType, folderId });
}
