import { useEffect, useState } from "react";
import { getSyncState, onSyncStateChange } from "@/services/sync";
import { usePluginStateStore } from "@/stores/pluginStateStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import {
  selectEffectiveSyncStatus,
  NOT_CONFIGURED_GIST_STATE,
  type EffectiveSync,
  type GistSyncState,
} from "@/services/syncStatus";

const GIST_SYNC_PLUGIN_ID = "plugin-gist-sync";

/** Subscribes to both sync engines + plan/plugin state and returns the effective
 *  sync status (same selection the desktop TitleBar uses). For non-desktop shells. */
export function useEffectiveSyncStatus(): EffectiveSync {
  const [syncState, setSyncState] = useState(getSyncState);
  useEffect(() => onSyncStateChange(() => setSyncState(getSyncState())), []);
  const gistSyncState = usePluginStateStore(
    (s) => s.read<GistSyncState>(GIST_SYNC_PLUGIN_ID, "sync-state") ?? NOT_CONFIGURED_GIST_STATE,
  );

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
