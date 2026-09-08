import { useTeamStore } from "@/stores/teamStore";

/**
 * The refresh every "I am now a member of this team" path owes, whether
 * membership came from accepting an invitation or from redeeming a join link.
 *
 * `joinAndLoadTeamVault` is called directly rather than left to the SSE
 * membership_changed handler: `loadTeams()` adds the team to the store before
 * that event is processed, so the handler sees a zero delta, skips
 * `onTeamAdded`, and the vault stays stuck at "forbidden".
 *
 * Imported lazily for the same reason it always was — `teamDataManager` pulls
 * in the sync stack, and a static edge here would close a cycle.
 */
export async function refreshAfterJoiningTeam(teamId: string): Promise<void> {
  const { joinAndLoadTeamVault } = await import("@/services/teamDataManager");
  await Promise.all([
    useTeamStore.getState().loadTeams(),
    useTeamStore.getState().loadMyPendingInvitations(),
    joinAndLoadTeamVault(teamId),
  ]);
}
