import i18n from "@/i18n";
import { useTeamStore } from "@/stores/teamStore";
import type { TeamRole } from "@/stores/teamStore";
import { inviteByEmail, revokePendingInvitation } from "@/services/teamService";
import { buildDeepLink } from "@/services/deepLinkUrl";
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

export async function removeTeamMember(args: {
  teamId: string;
  userId: string;
  handle: string;
}): Promise<void> {
  const { teamId, userId, handle } = args;
  await runTeamAction({
    pending: i18n.t("members.toast.removingMember", { name: handle }),
    success: i18n.t("members.toast.memberRemoved", { name: handle }),
    error: (e: Error) => i18n.t("members.error.removeFailed", { name: handle, reason: userFacingReason(e) }),
    run: () => useTeamStore.getState().removeMember(teamId, userId),
  });
}

export async function revokeInvitation(args: {
  teamId: string;
  invitationId: string;
  name: string;
}): Promise<void> {
  const { teamId, invitationId, name } = args;
  await runTeamAction({
    pending: i18n.t("members.toast.revokingInvitation", { name }),
    success: i18n.t("members.toast.invitationRevoked", { name }),
    error: (e: Error) => i18n.t("members.error.revokeFailed", { name, reason: userFacingReason(e) }),
    run: () => revokePendingInvitation(teamId, invitationId),
  });
}

// distributeKeyToNewMember returns quietly when this device cannot unwrap the
// key, so the key-holder check happens here — a button must not fail silently.
export async function grantVaultKeyToMember(args: {
  teamId: string;
  userId: string;
  handle: string;
  publicKey: string;
}): Promise<void> {
  const { teamId, userId, handle, publicKey } = args;
  await runTeamAction({
    pending: i18n.t("members.toast.grantingKey", { name: handle }),
    success: i18n.t("members.toast.keyGranted", { name: handle }),
    error: (e: Error) => i18n.t("members.error.grantKeyFailed", { name: handle, reason: userFacingReason(e) }),
    run: async () => {
      if (!publicKey) throw new Error(i18n.t("members.error.memberHasNoPublicKey"));
      const { getTeamVaultKey, distributeKeyToNewMember } = await import("@/services/teamVaultSync");
      try {
        await getTeamVaultKey(teamId);
      } catch {
        throw new Error(i18n.t("members.error.notAKeyHolder"));
      }
      await distributeKeyToNewMember(teamId, userId, publicKey);
    },
  });
}

/** Opens the invitee's own inbox entry. Carries no capability — the invitation
 *  row is already bound to that user — so the route is `navigate`. */
export function addressedInviteLink(invitationId: string): string {
  return buildDeepLink({ route: "notification", entryId: `invite:${invitationId}` });
}
