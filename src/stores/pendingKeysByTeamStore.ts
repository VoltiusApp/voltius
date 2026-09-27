import { create, type UseBoundStore, type StoreApi } from "zustand";
import { persist } from "zustand/middleware";

export interface PendingKeysByTeamStore {
  keysByTeamId: Record<string, string[]>;
  enqueue: (teamId: string, keys: string[]) => void;
  resolve: (teamId: string, keys: string[]) => void;
  clearAll: () => void;
}

/** Shared shape for a persisted "key names only, never values" retry queue keyed by team id. */
export function createPendingKeysByTeamStore(
  persistName: string,
): UseBoundStore<StoreApi<PendingKeysByTeamStore>> {
  return create<PendingKeysByTeamStore>()(
    persist(
      (set) => ({
        keysByTeamId: {},

        enqueue: (teamId, keys) =>
          set((s) => {
            if (keys.length === 0) return s;
            const merged = [...new Set([...(s.keysByTeamId[teamId] ?? []), ...keys])];
            return { keysByTeamId: { ...s.keysByTeamId, [teamId]: merged } };
          }),

        resolve: (teamId, keys) =>
          set((s) => {
            const pending = s.keysByTeamId[teamId];
            if (!pending) return s;
            const done = new Set(keys);
            const left = pending.filter((k) => !done.has(k));
            const next = { ...s.keysByTeamId };
            if (left.length > 0) next[teamId] = left;
            else delete next[teamId];
            return { keysByTeamId: next };
          }),

        clearAll: () => set({ keysByTeamId: {} }),
      }),
      { name: persistName },
    ),
  );
}
