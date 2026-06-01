import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PingStatus = "up" | "down" | "unknown";

export const DEFAULT_POLL_INTERVAL_MS = 10_000;
export const DEFAULT_ACTIVE_POLL_INTERVAL_MS = 2_000;

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
      partialize: (s) => ({ pollIntervalMs: s.pollIntervalMs, activePollIntervalMs: s.activePollIntervalMs }),
    },
  ),
);
