import { useEffect, useState } from "react";
import { getSyncState, onSyncStateChange } from "@/services/sync";
import { getGistSyncState, onGistSyncStateChange } from "@/plugins/gist-sync/sync-engine";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { selectEffectiveSyncStatus, type EffectiveSync } from "@/services/syncStatus";

/** Subscribes to both sync engines + plan/plugin state and returns the effective
 *  sync status (same selection the desktop TitleBar uses). For non-desktop shells. */
export function useEffectiveSyncStatus(): EffectiveSync {
  const [syncState, setSyncState] = useState(getSyncState);
  useEffect(() => onSyncStateChange(() => setSyncState(getSyncState())), []);
  const [gistSyncState, setGistSyncState] = useState(getGistSyncState);
  useEffect(() => onGistSyncStateChange(() => setGistSyncState(getGistSyncState())), []);

  const gistPluginEnabled = usePluginRegistryStore((s) => s.isEnabled("plugin-gist-sync", false));
  const accountMode = useSubscriptionStore((s) => s.accountMode);
  const isPro = useSubscriptionStore((s) => s.isPro);

  return selectEffectiveSyncStatus({
    voltius: syncState,
    gist: gistSyncState,
    accountMode,
    isPro,
    gistPluginEnabled,
  });
}
