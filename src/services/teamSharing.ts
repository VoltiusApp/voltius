import { useTeamStore } from "@/stores/teamStore";
import { getMyUserId } from "@/services/teamService";
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

/**
 * Every teammate across all of the caller's teams, deduped by user_id and with
 * the caller dropped, sorted online-first then alphabetically.
 */
export async function allTeammates(): Promise<TeamMember[]> {
  const { teams } = useTeamStore.getState();
  const [members, myUserId] = await Promise.all([membersOfTeams(teams.map((t) => t.id)), getMyUserId()]);

  const deduped = new Map<string, TeamMember>();
  for (const member of members) {
    if (member.user_id === myUserId || deduped.has(member.user_id)) continue;
    deduped.set(member.user_id, member);
  }

  return [...deduped.values()].sort((a, b) => {
    if (!!a.is_online !== !!b.is_online) return a.is_online ? -1 : 1;
    return a.display_name.localeCompare(b.display_name);
  });
}

/** Whether a member already has a route into the session: a vault they're in, live participation, or a standing invite. */
export function memberHasAccess(
  member: TeamMember,
  session: { vaultIds: string[]; participantIds: string[]; invitedIds: string[] },
): boolean {
  return (
    session.vaultIds.includes(member.team_id) ||
    session.participantIds.includes(member.user_id) ||
    session.invitedIds.includes(member.user_id)
  );
}
