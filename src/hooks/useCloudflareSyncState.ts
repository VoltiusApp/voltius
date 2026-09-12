import { useMemo } from "react";
import { usePluginStateStore } from "@/stores/pluginStateStore";
import {
  NOT_CONFIGURED_CLOUDFLARE_STATE,
  sanitizeCloudflareSyncState,
  type CloudflareSyncState,
} from "@/services/syncStatus";

const CLOUDFLARE_SYNC_PLUGIN_ID = "plugin-cloudflare-sync";

/** Reads the cloudflare-sync plugin's published `sync-state`, sanitized. Shared
 *  by every host surface that renders it (TitleBar, SyncDropdown,
 *  useEffectiveSyncStatus) so a plugin publishing a malformed shape can't crash
 *  any of them. Mirrors `useGistSyncState`. */
export function useCloudflareSyncState(): CloudflareSyncState {
  const raw = usePluginStateStore((s) => s.read<unknown>(CLOUDFLARE_SYNC_PLUGIN_ID, "sync-state"));
  return useMemo(
    () => (raw === undefined ? NOT_CONFIGURED_CLOUDFLARE_STATE : sanitizeCloudflareSyncState(raw, CLOUDFLARE_SYNC_PLUGIN_ID)),
    [raw],
  );
}
