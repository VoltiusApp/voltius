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
  /**
   * Teams whose stored credentials could not be pulled into the local keychain.
   * Distinct from a blocked status: the vault itself loaded and its hosts are
   * browsable, but any host needing a stored password, key, or passphrase will
   * fail at connect time. A member deserves to know that before pressing
   * connect rather than after an authentication failure (issue #190).
   */
  credentialsUnavailableByTeamId: Record<string, boolean>;
  setStatus: (teamId: string, s: TeamVaultStatus, error?: string) => void;
  setCredentialsUnavailable: (teamId: string, unavailable: boolean) => void;
  clearAll: () => void;
}

export const useTeamVaultStateStore = create<TeamVaultStateStore>((set) => ({
  statusByTeamId: {},
  errorByTeamId: {},
  credentialsUnavailableByTeamId: {},

  setStatus: (teamId, s, error) =>
    set((state) => ({
      statusByTeamId: { ...state.statusByTeamId, [teamId]: s },
      errorByTeamId: { ...state.errorByTeamId, [teamId]: error ?? null },
    })),

  setCredentialsUnavailable: (teamId, unavailable) =>
    set((state) =>
      (state.credentialsUnavailableByTeamId[teamId] ?? false) === unavailable
        ? state
        : {
            credentialsUnavailableByTeamId: {
              ...state.credentialsUnavailableByTeamId,
              [teamId]: unavailable,
            },
          },
    ),

  clearAll: () =>
    set({ statusByTeamId: {}, errorByTeamId: {}, credentialsUnavailableByTeamId: {} }),
}));
