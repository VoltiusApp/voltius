import type { PluginAPI } from "@/plugins/api";
import type { SyncStatus } from "./types";

let _api: PluginAPI;
let _status: SyncStatus = "idle";
let _lastSync: Date | null = null;
let _error: string | null = null;
let _configured = false;
let _pollInterval: ReturnType<typeof setInterval> | null = null;

export function getCloudflareSyncState() {
  return {
    status: _status,
    lastSync: _lastSync,
    error: _error,
    configured: _configured,
    blobSizeBytes: null as number | null,
  };
}

function publish() {
  _api.ui.publishState("sync-state", getCloudflareSyncState());
}

export function init(api: PluginAPI) {
  _api = api;
  publish();
  isConfigured()
    .then((c) => {
      _configured = c;
      publish();
    })
    .catch(() => {});
}

export async function isConfigured(): Promise<boolean> {
  const [url, token, passphrase] = await Promise.all([
    _api.storage.get<string>("workerUrl"),
    _api.vault.get("syncToken"),
    _api.vault.get("passphrase"),
  ]);
  return !!(url && token && passphrase);
}

/** No-op until Phase 9/10 wire real sync. */
export async function syncNow(_opts: { showProgress?: boolean } = {}): Promise<void> {
  if (!(await isConfigured())) return;
}

export async function push(): Promise<void> {
  // Phase 9
}

export function startPoll(intervalSeconds: number) {
  stopPoll();
  _pollInterval = setInterval(() => {
    void syncNow();
  }, intervalSeconds * 1000);
}

export function stopPoll() {
  if (_pollInterval !== null) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
}
