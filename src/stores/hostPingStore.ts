import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PingStatus = "up" | "down" | "unknown";

export const DEFAULT_POLL_INTERVAL_MS = 60_000;
export const DEFAULT_ACTIVE_POLL_INTERVAL_MS = 5_000;

/// Idle probes open real TCP connections; keep them clear of `ufw limit`,
/// which blocks after 6 new connections in 30s.
export const MIN_POLL_INTERVAL_MS = 10_000;
export const MIN_ACTIVE_POLL_INTERVAL_MS = 1_000;

interface PersistedHostPing {
  pollIntervalMs?: number;
  activePollIntervalMs?: number;
}

/// Pre-v1 defaults (10s idle, 2s active) opened enough connections to trip
/// host firewalls. Raise anything still at or below them; leave deliberate
/// slower choices untouched.
export function migrateHostPing(
  state: PersistedHostPing,
  version: number,
): { pollIntervalMs: number; activePollIntervalMs: number } {
  const pollIntervalMs = state.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const activePollIntervalMs = state.activePollIntervalMs ?? DEFAULT_ACTIVE_POLL_INTERVAL_MS;
  if (version >= 1) return { pollIntervalMs, activePollIntervalMs };
  return {
    pollIntervalMs: pollIntervalMs < MIN_POLL_INTERVAL_MS + 1 ? DEFAULT_POLL_INTERVAL_MS : pollIntervalMs,
    activePollIntervalMs:
      activePollIntervalMs < DEFAULT_ACTIVE_POLL_INTERVAL_MS
        ? DEFAULT_ACTIVE_POLL_INTERVAL_MS
        : activePollIntervalMs,
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
  priorityConnectionIds: string[];
  addPriorityConnection: (id: string) => void;
  removePriorityConnection: (id: string) => void;
}

export const useHostPingStore = create<HostPingStore>()(
  persist(
    (set) => ({
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      activePollIntervalMs: DEFAULT_ACTIVE_POLL_INTERVAL_MS,
      statuses: {},
      latencies: {},
      setPollIntervalMs: (v) => set({ pollIntervalMs: v }),
      setActivePollIntervalMs: (v) => set({ activePollIntervalMs: v }),
      setStatus: (id, status, latencyMs) =>
        set((s) => ({
          statuses: { ...s.statuses, [id]: status },
          latencies: latencyMs !== undefined
            ? { ...s.latencies, [id]: latencyMs }
            : s.latencies,
        })),
      clearStatuses: () => set({ statuses: {}, latencies: {} }),
      priorityConnectionIds: [],
      addPriorityConnection: (id) =>
        set((s) => ({ priorityConnectionIds: s.priorityConnectionIds.includes(id) ? s.priorityConnectionIds : [...s.priorityConnectionIds, id] })),
      removePriorityConnection: (id) =>
        set((s) => ({ priorityConnectionIds: s.priorityConnectionIds.filter((x) => x !== id) })),
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
