import { scheduleSync } from "@/services/sync";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";

/** A local edit to synced data: nearby devices hear it in every account mode, the cloud only when signed in. */
export function syncAfterEdit(typeId?: string, id?: string): void {
  const prefs = useSyncPrefsStore.getState();
  const synced = !typeId || (id ? prefs.isObjectSynced(id, typeId) : prefs.isTypeSynced(typeId));
  if (synced) scheduleSync();
}
