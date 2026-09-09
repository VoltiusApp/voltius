import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Keychain keys that a team offboarding wipe failed to delete.
 *
 * `clearTeamStoresAndSecrets` derives its key names from the team objects held
 * in the stores, then empties those stores — so once a removal has run, a key
 * whose delete failed can never be named again. Without this queue a failed
 * wipe leaves the team's plaintext passwords and private keys on the device
 * permanently, with nothing left to retry from (issues #216, #233).
 *
 * Only key names are persisted, never secret material.
 */
interface PendingSecretWipeStore {
  keysByTeamId: Record<string, string[]>;
  enqueue: (teamId: string, keys: string[]) => void;
  resolve: (teamId: string, keys: string[]) => void;
  clearAll: () => void;
}

export const usePendingSecretWipeStore = create<PendingSecretWipeStore>()(
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
    { name: "voltius-pending-secret-wipe" },
  ),
);
