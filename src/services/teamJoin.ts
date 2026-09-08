import { useTeamStore } from "@/stores/teamStore";

// joinAndLoadTeamVault is called directly rather than left to the SSE
// membership_changed handler: loadTeams() adds the team first, so the handler
// sees a zero delta and the vault stays stuck at "forbidden".
// Imported lazily to avoid a cycle through teamDataManager's sync stack.
export async function refreshAfterJoiningTeam(teamId: string): Promise<void> {
  const { joinAndLoadTeamVault } = await import("@/services/teamDataManager");
  await Promise.all([
    useTeamStore.getState().loadTeams(),
    useTeamStore.getState().loadMyPendingInvitations(),
    joinAndLoadTeamVault(teamId),
  ]);
}
