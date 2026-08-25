import i18n from "@/i18n";
import { useTeamStore } from "@/stores/teamStore";
import { inviteByEmail } from "@/services/teamService";
import { runTeamAction } from "@/services/teamActionFeedback";

/**
 * Invite a known user.
 *
 * The role is passed to `addMemberById`, which the server stores on the pending
 * invitation row. Assigning a role afterwards only works for someone who is
 * already a member: a pending invitee has no `team_members` row, so that call
 * 404s. The old code did exactly that and swallowed the failure, which is why an
 * invitee always landed on the default role.
 */
export async function inviteUserById(args: {
  teamId: string;
  userId: string;
  handle: string;
  roleName: string;
  roleId: string;
}): Promise<{ status: "pending" | "already_member" }> {
  const { teamId, userId, handle, roleName, roleId } = args;
  const { addMemberById, assignMemberRole } = useTeamStore.getState();

  const result = await runTeamAction({
    pending: i18n.t("members.toast.invitingUser", { name: handle }),
    success: (r: { status: string }) =>
      r.status === "pending"
        ? i18n.t("members.toast.invitationSentToUser", { name: handle })
        : i18n.t("members.toast.userAdded", { name: handle }),
    error: (e: Error) => i18n.t("members.error.inviteFailed", { name: handle, reason: e.message }),
    run: () => addMemberById(teamId, userId, roleName),
  });

  if (result.status === "already_member") {
    await assignMemberRole(teamId, userId, roleId);
  }
  return result;
}

export async function inviteByEmailAddress(args: {
  teamId: string;
  email: string;
  roleName: string;
}): Promise<{ status: "added" | "invited" }> {
  const { teamId, email, roleName } = args;
  return runTeamAction({
    pending: i18n.t("members.toast.invitingUser", { name: email }),
    success: i18n.t("members.toast.invitationSentToUser", { name: email }),
    error: (e: Error) => i18n.t("members.error.inviteFailed", { name: email, reason: e.message }),
    run: () => inviteByEmail(teamId, email, roleName),
  });
}
