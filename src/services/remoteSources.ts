import type { BlobVersion } from "./settledBlobs";

export type RemoteSourceFailure = "unavailable" | "undecryptable" | "unreadable";
export type RemoteSourceState = "synced" | "pending" | RemoteSourceFailure;

export interface RemoteSource {
  deviceId: string;
  remoteUpdatedAt: string;
  state: RemoteSourceState;
  syncedAt: string | null;
  failedAt: string | null;
  httpStatus: number | null;
}

const FAILURES: readonly RemoteSourceState[] = ["unavailable", "undecryptable", "unreadable"];

export const isFailing = (s: RemoteSource): boolean => FAILURES.includes(s.state);

/** Outcome of the latest pull of each remote device's blob; no payload content is kept. */
export function createRemoteSources(now: () => string = () => new Date().toISOString()) {
  let sources = new Map<string, RemoteSource>();
  let snapshot: RemoteSource[] = [];
  const listeners = new Set<() => void>();

  const commit = (next: Map<string, RemoteSource>) => {
    sources = next;
    snapshot = [...next.values()];
    listeners.forEach((fn) => fn());
  };
  const patch = (deviceId: string, fields: Partial<RemoteSource>) => {
    const cur = sources.get(deviceId);
    if (!cur) return;
    commit(new Map(sources).set(deviceId, { ...cur, ...fields }));
  };

  return {
    /** Keeps only `remote`; a device seen for the first time, or with a newer blob, is pending. */
    track(remote: BlobVersion[]): void {
      const next = new Map<string, RemoteSource>();
      for (const { device_id: deviceId, updated_at } of remote) {
        const cur = sources.get(deviceId);
        next.set(deviceId, cur?.remoteUpdatedAt === updated_at ? cur : {
          deviceId,
          remoteUpdatedAt: updated_at,
          state: "pending",
          syncedAt: cur?.syncedAt ?? null,
          failedAt: cur?.failedAt ?? null,
          httpStatus: cur?.httpStatus ?? null,
        });
      }
      commit(next);
    },
    succeeded(blob: BlobVersion): void {
      patch(blob.device_id, { remoteUpdatedAt: blob.updated_at, state: "synced", syncedAt: now(), httpStatus: null });
    },
    failed(blob: BlobVersion, failure: RemoteSourceFailure, httpStatus: number | null = null): void {
      patch(blob.device_id, { remoteUpdatedAt: blob.updated_at, state: failure, failedAt: now(), httpStatus });
    },
    drop(deviceId: string): void {
      if (!sources.has(deviceId)) return;
      const next = new Map(sources);
      next.delete(deviceId);
      commit(next);
    },
    clear(): void {
      if (sources.size > 0) commit(new Map());
    },
    list: (): RemoteSource[] => snapshot,
    failing: (): RemoteSource[] => snapshot.filter(isFailing),
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

export const remoteSources = createRemoteSources();

/** Names come from what this device already holds: the device's last live-session manifest, then the local network list. */
export function remoteSourceName(
  deviceId: string,
  manifests: Record<string, { deviceName?: string }>,
  known: Record<string, { name?: string }>,
): string | null {
  return manifests[deviceId]?.deviceName || known[deviceId]?.name || null;
}
