import { acceptMyPendingInvitation, declineMyPendingInvitation } from "@/services/teamService";
import { useTeamStore } from "@/stores/teamStore";

/**
 * Accepts an invitation and loads the team's vault.
 *
 * joinAndLoadTeamVault is called directly rather than left to the SSE
 * membership_changed handler: loadTeams() adds the team to the store before that
 * event is processed, so the handler sees a zero delta, skips onTeamAdded, and the
 * vault stays stuck at "forbidden".
 */
export async function acceptInvitation(invitationId: string, teamId: string): Promise<void> {
  await acceptMyPendingInvitation(invitationId);
  const { joinAndLoadTeamVault } = await import("@/services/teamDataManager");
  await Promise.all([
    useTeamStore.getState().loadTeams(),
    useTeamStore.getState().loadMyPendingInvitations(),
    joinAndLoadTeamVault(teamId),
  ]);
}

export async function declineInvitation(invitationId: string): Promise<void> {
  await declineMyPendingInvitation(invitationId);
  await useTeamStore.getState().loadMyPendingInvitations();
}
