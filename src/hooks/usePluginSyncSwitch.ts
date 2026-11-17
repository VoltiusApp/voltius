import { useSyncProviders } from "@/hooks/useSyncProviders";
import { installedSourceId, pluginSyncBlockedReason } from "@/services/pluginSync";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import type { SeededEntry } from "@/stores/seededTombstoneStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";

export function usePluginSyncSwitch(
  id: string,
  seeded: Map<string, SeededEntry>,
): { synced: boolean; reason: string | null; toggle: () => void } {
  const { effective } = useSyncProviders();
  const synced = useSyncPrefsStore((s) => !s.excludedIds.includes(id));
  useSyncPrefsStore((s) => s.syncTypes);
  useLanSyncStore((s) => s.known);
  return {
    synced,
    reason: pluginSyncBlockedReason(id, installedSourceId(id, seeded), effective),
    toggle: () => useSyncPrefsStore.getState().toggleExcluded(id),
  };
}
