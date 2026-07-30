import { usePluginStateStore } from "@/stores/pluginStateStore";
import { NOT_CONFIGURED_GIST_STATE, sanitizeGistSyncState, type GistSyncState } from "@/services/syncStatus";

const GIST_SYNC_PLUGIN_ID = "plugin-gist-sync";

/** Reads the gist-sync plugin's published `sync-state`, sanitized. Shared by every
 *  host surface that renders it (TitleBar, SyncDropdown, useEffectiveSyncStatus) so
 *  a plugin publishing a malformed shape can't crash any of them. */
export function useGistSyncState(): GistSyncState {
  return usePluginStateStore((s) => {
    const raw = s.read<unknown>(GIST_SYNC_PLUGIN_ID, "sync-state");
    return raw === undefined ? NOT_CONFIGURED_GIST_STATE : sanitizeGistSyncState(raw, GIST_SYNC_PLUGIN_ID);
  });
}
