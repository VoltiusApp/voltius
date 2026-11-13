import { getSyncState, onSyncStateChange } from "@/services/sync";
import { remoteSourceName, remoteSources } from "@/services/remoteSources";
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";
import { useLanSyncStore } from "@/stores/lanSyncStore";

const WRITE_DELAY_MS = 2_000;

export function syncMirror() {
  const { status, lastSync, error } = getSyncState();
  const { manifests } = useCrossDeviceSessionsStore.getState();
  const { known } = useLanSyncStore.getState();
  return {
    status,
    lastSync: lastSync?.toISOString() ?? null,
    error,
    devices: remoteSources.list().map((s) => ({ ...s, name: remoteSourceName(s.deviceId, manifests, known) })),
  };
}

/** Rewrites the CLI mirror shortly after each finished sync. */
export function watchSyncForCli(write: () => Promise<void>): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const off = onSyncStateChange(() => {
    if (getSyncState().status === "syncing") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void write();
    }, WRITE_DELAY_MS);
  });
  return () => {
    off();
    if (timer) clearTimeout(timer);
  };
}
