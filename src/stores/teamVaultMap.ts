import { useTeamStore } from "@/stores/teamStore";
import type { VaultTransition } from "@/services/teamVaultMigration";

/** Team-vault objects live in a `Record<teamId, items[]>` beside the local list. */
export type TeamMap<T> = Record<string, T[]>;

interface Identifiable {
  id: string;
}

export function isTeamVaultId(vaultId: string | null | undefined): vaultId is string {
  if (!vaultId) return false;
  return useTeamStore.getState().teams.some((t) => t.id === vaultId);
}

export function upsertById<T extends Identifiable>(arr: T[], item: T): T[] {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...arr, item];
  const next = [...arr];
  next[idx] = item;
  return next;
}

export function findTeamEntry<T extends Identifiable>(
  teamMap: TeamMap<T>,
  id: string,
): { teamId: string; item: T } | null {
  for (const [teamId, items] of Object.entries(teamMap)) {
    const item = items.find((x) => x.id === id);
    if (item) return { teamId, item };
  }
  return null;
}

export function setTeamMapEntry<T>(map: TeamMap<T>, teamId: string, items: T[]): TeamMap<T> {
  return { ...map, [teamId]: items };
}

/** No `teamId` clears every vault, matching the stores' `clearTeam*(teamId?)`. */
export function clearTeamMapEntry<T>(map: TeamMap<T>, teamId?: string): TeamMap<T> {
  if (teamId === undefined) return {};
  const next = { ...map };
  delete next[teamId];
  return next;
}

export function upsertInTeamMap<T extends Identifiable>(
  map: TeamMap<T>,
  teamId: string,
  item: T,
): TeamMap<T> {
  return { ...map, [teamId]: upsertById(map[teamId] ?? [], item) };
}

export function removeFromTeamMap<T extends Identifiable>(
  map: TeamMap<T>,
  teamId: string,
  id: string,
): TeamMap<T> {
  return { ...map, [teamId]: (map[teamId] ?? []).filter((x) => x.id !== id) };
}

/**
 * Re-files an object in the team map after a vault move. `stayTeamId` is the
 * vault a `same-scope` transition leaves it in — pass the source team on a team
 * branch, and omit it on a local branch where a same-scope move never touches
 * the map. The local list is the caller's business; only the map is returned.
 */
export function applyVaultTransition<T extends Identifiable>(
  map: TeamMap<T>,
  transition: VaultTransition,
  id: string,
  item: T,
  stayTeamId?: string,
): TeamMap<T> {
  if (transition.kind === "local-to-team") {
    return upsertInTeamMap(map, transition.destinationTeamId, item);
  }
  if (transition.kind === "team-to-team") {
    return upsertInTeamMap(
      removeFromTeamMap(map, transition.sourceTeamId, id),
      transition.destinationTeamId,
      item,
    );
  }
  if (transition.kind === "team-to-local") {
    return removeFromTeamMap(map, transition.sourceTeamId, id);
  }
  return stayTeamId === undefined ? map : upsertInTeamMap(map, stayTeamId, item);
}
