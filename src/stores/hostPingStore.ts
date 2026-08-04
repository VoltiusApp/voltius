import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PingStatus = "up" | "down" | "unknown";

export const DEFAULT_POLL_INTERVAL_MS = 60_000;
export const DEFAULT_ACTIVE_POLL_INTERVAL_MS = 5_000;

/// Idle probes open real TCP connections; keep them clear of `ufw limit`,
/// which blocks after 6 new connections in 30s.
export const MIN_POLL_INTERVAL_MS = 10_000;
export const MIN_ACTIVE_POLL_INTERVAL_MS = 1_000;

// Pre-v1 defaults, kept only as the migration's raise-threshold.
const LEGACY_POLL_INTERVAL_MS = 10_000;
const LEGACY_ACTIVE_POLL_INTERVAL_MS = 2_000;

interface PersistedHostPing {
  pollIntervalMs?: number;
  activePollIntervalMs?: number;
}

function clampPoll(v: number): number {
  return Math.max(v, MIN_POLL_INTERVAL_MS);
}

function clampActive(v: number): number {
  return Math.max(v, MIN_ACTIVE_POLL_INTERVAL_MS);
}

/// Pre-v1 defaults (10s idle, 2s active) opened enough connections to trip
/// host firewalls. Raise anything still at or below the pre-v1 default for
/// its own interval; leave deliberate slower choices untouched. The result
/// is always clamped to the MIN_* floor, including on the already-migrated
/// (version >= 1) path, so a hand-edited or corrupted persisted value can
/// never reintroduce the flood.
export function migrateHostPing(
  state: PersistedHostPing,
  version: number,
): { pollIntervalMs: number; activePollIntervalMs: number } {
  const pollIntervalMs = state.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const activePollIntervalMs = state.activePollIntervalMs ?? DEFAULT_ACTIVE_POLL_INTERVAL_MS;
  if (version >= 1) {
    return { pollIntervalMs: clampPoll(pollIntervalMs), activePollIntervalMs: clampActive(activePollIntervalMs) };
  }
  return {
    pollIntervalMs: clampPoll(pollIntervalMs <= LEGACY_POLL_INTERVAL_MS ? DEFAULT_POLL_INTERVAL_MS : pollIntervalMs),
    activePollIntervalMs: clampActive(
      activePollIntervalMs <= LEGACY_ACTIVE_POLL_INTERVAL_MS ? DEFAULT_ACTIVE_POLL_INTERVAL_MS : activePollIntervalMs,
    ),
  };
}

interface HostPingStore {
  pollIntervalMs: number;
  setPollIntervalMs: (v: number) => void;
  activePollIntervalMs: number;
  setActivePollIntervalMs: (v: number) => void;
  statuses: Record<string, PingStatus>;
  latencies: Record<string, number>;
  setStatus: (id: string, status: PingStatus, latencyMs?: number) => void;
  clearStatuses: () => void;
}

export const useHostPingStore = create<HostPingStore>()(
  persist(
    (set) => ({
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      activePollIntervalMs: DEFAULT_ACTIVE_POLL_INTERVAL_MS,
      statuses: {},
      latencies: {},
      setPollIntervalMs: (v) => set({ pollIntervalMs: clampPoll(v) }),
      setActivePollIntervalMs: (v) => set({ activePollIntervalMs: clampActive(v) }),
      setStatus: (id, status, latencyMs) =>
        set((s) => ({
          statuses: { ...s.statuses, [id]: status },
          latencies: latencyMs !== undefined
            ? { ...s.latencies, [id]: latencyMs }
            : s.latencies,
        })),
      clearStatuses: () => set({ statuses: {}, latencies: {} }),
    }),
    {
      name: "voltius-host-ping",
      version: 1,
      migrate: (persisted, version) =>
        migrateHostPing((persisted ?? {}) as PersistedHostPing, version) as never,
      partialize: (s) => ({ pollIntervalMs: s.pollIntervalMs, activePollIntervalMs: s.activePollIntervalMs }),
    },
  ),
);
