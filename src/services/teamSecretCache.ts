import { create } from "zustand";

const byTeam = new Map<string, Map<string, string>>();

export const useTeamSecretsHydrated = create<{ byTeam: Record<string, number> }>(() => ({ byTeam: {} }));

function markTeam(teamId: string, change: "hydrated" | "changed" | "cleared"): void {
  useTeamSecretsHydrated.setState((s) => {
    if (change === "changed" && !(teamId in s.byTeam)) return s;
    const next = { ...s.byTeam };
    if (change === "cleared") delete next[teamId];
    else next[teamId] = (next[teamId] ?? 0) + 1;
    return { byTeam: next };
  });
}

export const teamSecretCache = {
  get: (teamId: string, key: string): string | undefined => byTeam.get(teamId)?.get(key),
  set(teamId: string, key: string, value: string): void {
    const entries = byTeam.get(teamId) ?? new Map<string, string>();
    entries.set(key, value);
    byTeam.set(teamId, entries);
    markTeam(teamId, "changed");
  },
  delete: (teamId: string, key: string): void => {
    byTeam.get(teamId)?.delete(key);
    markTeam(teamId, "changed");
  },
  entries: (teamId: string): Map<string, string> => new Map(byTeam.get(teamId) ?? []),
  replaceTeam: (teamId: string, entries: Map<string, string>): void => {
    byTeam.set(teamId, new Map(entries));
    markTeam(teamId, "hydrated");
  },
  clearTeam: (teamId: string): void => {
    byTeam.delete(teamId);
    markTeam(teamId, "cleared");
  },
  clearAll: (): void => {
    byTeam.clear();
    useTeamSecretsHydrated.setState({ byTeam: {} });
  },
  isHydrated: (teamId: string): boolean => teamId in useTeamSecretsHydrated.getState().byTeam,
};
