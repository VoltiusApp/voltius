import { acceptMyPendingInvitation, declineMyPendingInvitation } from "@/services/teamService";
import { refreshAfterJoiningTeam } from "@/services/teamJoin";
import { useTeamStore } from "@/stores/teamStore";

/** Accepts an invitation and loads the team's vault. */
export async function acceptInvitation(invitationId: string, teamId: string): Promise<void> {
  await acceptMyPendingInvitation(invitationId);
  await refreshAfterJoiningTeam(teamId);
}

export async function declineInvitation(invitationId: string): Promise<void> {
  await declineMyPendingInvitation(invitationId);
  await useTeamStore.getState().loadMyPendingInvitations();
}
