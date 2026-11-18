import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ConnectionUsageEntry } from "@/services/connectionPresence";

interface ConnectionPresenceStore {
  /** connection_id -> teammate user_ids currently broadcasting "in use" */
  usageByConnection: Record<string, string[]>;
  /** Cached current-user ID for synchronous self-exclusion in per-card hooks. */
  myUserId: string | null;
  /** Bumped each time the realtime stream opens; the server drops our usage when our last stream closes. */
  streamEpoch: number;

  setMyUserId: (id: string | null) => void;
  setSnapshot: (entries: ConnectionUsageEntry[]) => void;
  addUser: (connectionId: string, userId: string) => void;
  removeUser: (connectionId: string, userId: string) => void;
  clear: () => void;
  markStreamOpen: () => void;
}

export const useConnectionPresenceStore = create<ConnectionPresenceStore>()(
  persist(
    (set) => ({
      usageByConnection: {},
      myUserId: null,
      streamEpoch: 0,

      setMyUserId: (id) => set({ myUserId: id }),

      setSnapshot: (entries) =>
        set(() => ({
          usageByConnection: Object.fromEntries(
            entries.map((e) => [e.connection_id, [...new Set(e.user_ids)]]),
          ),
        })),

      addUser: (connectionId, userId) =>
        set((s) => {
          const existing = s.usageByConnection[connectionId] ?? [];
          if (existing.includes(userId)) return s;
          return {
            usageByConnection: { ...s.usageByConnection, [connectionId]: [...existing, userId] },
          };
        }),

      removeUser: (connectionId, userId) =>
        set((s) => {
          const existing = s.usageByConnection[connectionId];
          if (!existing) return s;
          const next = existing.filter((id) => id !== userId);
          const map = { ...s.usageByConnection };
          if (next.length === 0) delete map[connectionId];
          else map[connectionId] = next;
          return { usageByConnection: map };
        }),

      clear: () => set({ usageByConnection: {} }),
      markStreamOpen: () => set((s) => ({ streamEpoch: s.streamEpoch + 1 })),
    }),
    {
      name: "voltius-connection-presence",
      partialize: () => ({}),
    },
  ),
);
