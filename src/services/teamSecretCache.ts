import { create } from "zustand";

// What the server holds, and over it the values whose upload has not landed yet.
const byTeam = new Map<string, Map<string, string>>();
const unsent = new Map<string, Map<string, string>>();

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

const layerOf = (layers: Map<string, Map<string, string>>, teamId: string): Map<string, string> => {
  const layer = layers.get(teamId) ?? new Map<string, string>();
  layers.set(teamId, layer);
  return layer;
};

export const teamSecretCache = {
  get: (teamId: string, key: string): string | undefined => unsent.get(teamId)?.get(key) ?? byTeam.get(teamId)?.get(key),
  /** Records a value the server holds; an unsent value for the key survives unless it is this one. */
  set(teamId: string, key: string, value: string): void {
    layerOf(byTeam, teamId).set(key, value);
    if (unsent.get(teamId)?.get(key) === value) unsent.get(teamId)?.delete(key);
    markTeam(teamId, "changed");
  },
  hold(teamId: string, key: string, value: string): void {
    layerOf(unsent, teamId).set(key, value);
    markTeam(teamId, "changed");
  },
  /** Stops showing `value` as unsent, unless a newer write replaced it meanwhile. */
  release(teamId: string, key: string, value: string): void {
    if (unsent.get(teamId)?.get(key) !== value) return;
    unsent.get(teamId)?.delete(key);
    markTeam(teamId, "changed");
  },
  delete: (teamId: string, key: string): void => {
    byTeam.get(teamId)?.delete(key);
    unsent.get(teamId)?.delete(key);
    markTeam(teamId, "changed");
  },
  entries: (teamId: string): Map<string, string> => new Map(byTeam.get(teamId) ?? []),
  unsent: (teamId: string): Map<string, string> => new Map(unsent.get(teamId) ?? []),
  replaceTeam: (teamId: string, entries: Map<string, string>): void => {
    byTeam.set(teamId, new Map(entries));
    markTeam(teamId, "hydrated");
  },
  clearTeam: (teamId: string): void => {
    byTeam.delete(teamId);
    unsent.delete(teamId);
    markTeam(teamId, "cleared");
  },
  clearAll: (): void => {
    byTeam.clear();
    unsent.clear();
    useTeamSecretsHydrated.setState({ byTeam: {} });
  },
  isHydrated: (teamId: string): boolean => teamId in useTeamSecretsHydrated.getState().byTeam,
};
