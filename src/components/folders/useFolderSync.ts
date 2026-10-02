import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import type { Folder } from "@/types";

// Snippet folders sync under the "folder" type too (see getExcludedObjectIds).
export function useFolderSync(folder: Folder) {
  const isSynced = useSyncPrefsStore((s) => s.isObjectSynced(folder.id, "folder"));
  const toggleExcluded = useSyncPrefsStore((s) => s.toggleExcluded);
  return { isSynced, onToggleSync: () => toggleExcluded(folder.id) };
}
