import { create } from "zustand";

export type TeamVaultStatus =
  | "idle"
  | "loading"
  | "loaded"
  | "offline"
  | "forbidden"
  | "payment_required"
  | "awaiting_key"
  | "error";

/**
 * Statuses where the vault's pages have nothing truthful to render, so a shell
 * shows the explanatory panel instead. `loading` is excluded on purpose — it
 * resolves on its own and flashing a panel through it reads as an error.
 */
const BLOCKED_STATUSES = new Set<TeamVaultStatus>([
  "offline",
  "forbidden",
  "payment_required",
  "awaiting_key",
  "error",
]);

export function isBlockedTeamVaultStatus(status: TeamVaultStatus | undefined | null): boolean {
  return !!status && BLOCKED_STATUSES.has(status);
}

interface TeamVaultStateStore {
  statusByTeamId: Record<string, TeamVaultStatus>;
  errorByTeamId: Record<string, string | null>;
  setStatus: (teamId: string, s: TeamVaultStatus, error?: string) => void;
  clearAll: () => void;
}

export const useTeamVaultStateStore = create<TeamVaultStateStore>((set) => ({
  statusByTeamId: {},
  errorByTeamId: {},

  setStatus: (teamId, s, error) =>
    set((state) => ({
      statusByTeamId: { ...state.statusByTeamId, [teamId]: s },
      errorByTeamId: { ...state.errorByTeamId, [teamId]: error ?? null },
    })),

  clearAll: () => set({ statusByTeamId: {}, errorByTeamId: {} }),
}));
