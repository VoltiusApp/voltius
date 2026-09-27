const byTeam = new Map<string, Map<string, string>>();

export const teamSecretCache = {
  get: (teamId: string, key: string): string | undefined => byTeam.get(teamId)?.get(key),
  set(teamId: string, key: string, value: string): void {
    const entries = byTeam.get(teamId) ?? new Map<string, string>();
    entries.set(key, value);
    byTeam.set(teamId, entries);
  },
  delete: (teamId: string, key: string): void => {
    byTeam.get(teamId)?.delete(key);
  },
  entries: (teamId: string): Map<string, string> => new Map(byTeam.get(teamId) ?? []),
  replaceTeam: (teamId: string, entries: Map<string, string>): void => {
    byTeam.set(teamId, new Map(entries));
  },
  clearTeam: (teamId: string): void => {
    byTeam.delete(teamId);
  },
  clearAll: (): void => byTeam.clear(),
};
