import i18n from "@/i18n";
import { useTeamStore } from "@/stores/teamStore";
import type { TeamRole } from "@/stores/teamStore";
import { inviteByEmail } from "@/services/teamService";
import { runTeamAction } from "@/services/teamActionFeedback";
import { leastPrivilegedRole } from "@/components/vault-share/vaultShareModel";
import { userFacingReason } from "@/services/errorReason";

/** Invite-side name for the shared URL-stripping reason. */
export const inviteFailureReason = userFacingReason;

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
  roleId?: string;
}): Promise<{ status: "pending" | "already_member" }> {
  const { teamId, userId, handle, roleName, roleId } = args;
  const { addMemberById, assignMemberRole } = useTeamStore.getState();

  const result = await runTeamAction({
    pending: i18n.t("members.toast.invitingUser", { name: handle }),
    success: (r: { status: string }) =>
      r.status === "pending"
        ? i18n.t("members.toast.invitationSentToUser", { name: handle })
        : i18n.t("members.toast.userAdded", { name: handle }),
    error: (e: Error) => i18n.t("members.error.inviteFailed", { name: handle, reason: inviteFailureReason(e) }),
    run: () => addMemberById(teamId, userId, roleName),
  });

  if (result.status === "already_member" && roleId) {
    await assignMemberRole(teamId, userId, roleId);
  }
  return result;
}

/**
 * Invite a known user with a set of chosen roles — the one shape every invite
 * surface uses.
 *
 * Only the first role can travel on the invitation, so the rest are assigned
 * afterwards and only for someone who is already a member; for a pending
 * invitee there is no `team_members` row to assign them to.
 *
 * With nothing chosen the fallback is the least-privileged assignable role,
 * never "member": callers disable their invite actions without a selection, so
 * reaching here at all means the choice was lost rather than made.
 */
export async function inviteUserWithRoles(args: {
  teamId: string;
  userId: string;
  handle: string;
  roleIds: string[];
  roles: TeamRole[];
}): Promise<{ status: "pending" | "already_member" }> {
  const { teamId, userId, handle, roleIds, roles } = args;
  const chosen = roleIds.map((id) => roles.find((r) => r.id === id)).filter((r): r is TeamRole => !!r);
  const [first, ...rest] = chosen.length > 0 ? chosen : [leastPrivilegedRole(roles)].filter((r): r is TeamRole => !!r);

  const result = await inviteUserById({
    teamId,
    userId,
    handle,
    roleName: first?.name ?? "connect-only",
    roleId: first?.id,
  });

  if (result.status === "already_member") {
    // Best-effort: the invite itself already landed, so one extra role that
    // fails to apply must not report the whole invite as failed.
    const { assignMemberRole } = useTeamStore.getState();
    for (const role of rest) {
      await assignMemberRole(teamId, userId, role.id).catch(() => {});
    }
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
    error: (e: Error) => i18n.t("members.error.inviteFailed", { name: email, reason: inviteFailureReason(e) }),
    run: () => inviteByEmail(teamId, email, roleName),
  });
}
