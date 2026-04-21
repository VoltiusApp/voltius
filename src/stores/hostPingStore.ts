import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PingStatus = "up" | "down" | "unknown";

interface HostPingStore {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  statuses: Record<string, PingStatus>;
  setStatus: (id: string, status: PingStatus) => void;
  clearStatuses: () => void;
}

export const useHostPingStore = create<HostPingStore>()(
  persist(
    (set) => ({
      enabled: true,
      statuses: {},
      setEnabled: (v) => set({ enabled: v }),
      setStatus: (id, status) =>
        set((s) => ({ statuses: { ...s.statuses, [id]: status } })),
      clearStatuses: () => set({ statuses: {} }),
    }),
    {
      name: "voltius-host-ping",
      partialize: (s) => ({ enabled: s.enabled }),
    },
  ),
);
