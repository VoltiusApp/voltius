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
