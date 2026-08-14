import { useTeamStore } from "@/stores/teamStore";
import type { TeamMember } from "@/services/teamService";

const OWNER_TIER_RANK: Record<string, number> = { business: 2, teams: 1 };

/**
 * Highest owner tier across the given team vaults. A shared session's guest cap
 * comes from the owner's plan, so sharing to several vaults takes the best one.
 */
export function highestOwnerTier(teamIds: string[]): string {
  const { teams } = useTeamStore.getState();
  return teamIds
    .map((id) => teams.find((t) => t.id === id)?.owner_tier ?? "free")
    .reduce((best, t) => ((OWNER_TIER_RANK[t] ?? 0) > (OWNER_TIER_RANK[best] ?? 0) ? t : best), "free");
}

/** Members of the given team vaults, loading any the UI has not visited yet. */
export async function membersOfTeams(teamIds: string[]): Promise<TeamMember[]> {
  const store = useTeamStore.getState();
  await Promise.all(teamIds.map((id) => (store.membersByTeam[id] ? Promise.resolve() : store.loadMembers(id))));
  const { membersByTeam } = useTeamStore.getState();
  return teamIds.flatMap((id) => membersByTeam[id] ?? []);
}
