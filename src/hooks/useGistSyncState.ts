import { useMemo } from "react";
import { usePluginStateStore } from "@/stores/pluginStateStore";
import { NOT_CONFIGURED_GIST_STATE, sanitizeGistSyncState, type GistSyncState } from "@/services/syncStatus";

const GIST_SYNC_PLUGIN_ID = "plugin-gist-sync";

/** Reads the gist-sync plugin's published `sync-state`, sanitized. Shared by every
 *  host surface that renders it (TitleBar, SyncDropdown, useEffectiveSyncStatus) so
 *  a plugin publishing a malformed shape can't crash any of them.
 *
 *  The store keeps `raw` reference-stable across re-renders (it only changes when
 *  the plugin actually republishes), so `useMemo` on `raw` gives a stable sanitized
 *  result without needing `sanitizeGistSyncState` to cache anything itself. */
export function useGistSyncState(): GistSyncState {
  const raw = usePluginStateStore((s) => s.read<unknown>(GIST_SYNC_PLUGIN_ID, "sync-state"));
  return useMemo(
    () => (raw === undefined ? NOT_CONFIGURED_GIST_STATE : sanitizeGistSyncState(raw, GIST_SYNC_PLUGIN_ID)),
    [raw],
  );
}
