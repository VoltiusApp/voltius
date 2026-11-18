import { useSyncProviders } from "@/hooks/useSyncProviders";
import { installedSourceId, pluginSyncBlockedReason, pluginSyncGlobalBlockedReason, type SyncChannels } from "@/services/pluginSync";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import type { SeededEntry } from "@/stores/seededTombstoneStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";

function usePluginSyncChannels(): SyncChannels {
  const { effective } = useSyncProviders();
  useSyncPrefsStore((s) => s.syncTypes);
  const isPro = useSubscriptionStore((s) => s.isPro);
  const lanKnown = useLanSyncStore((s) => Object.keys(s.known).length > 0);
  return { ...effective, isPro, lanKnown };
}

export function usePluginSyncGlobalReason(): string | null {
  return pluginSyncGlobalBlockedReason(usePluginSyncChannels());
}

export function usePluginSyncSwitch(
  id: string,
  seeded: Map<string, SeededEntry>,
): { synced: boolean; reason: string | null; toggle: () => void } {
  const channels = usePluginSyncChannels();
  const synced = useSyncPrefsStore((s) => !s.excludedIds.includes(id));
  return {
    synced,
    reason: pluginSyncBlockedReason(id, installedSourceId(id, seeded), channels),
    toggle: () => useSyncPrefsStore.getState().toggleExcluded(id),
  };
}
