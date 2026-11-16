import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useVaultStore, type Vault } from "@/stores/vaultStore";
import { useTeamStore, type TeamMember, type TeamRole } from "@/stores/teamStore";
import type { PendingInvitation, Team } from "@/services/teamService";
import type { SortMode } from "@/stores/uiStore";
import { useHistoryStore } from "@/stores/historyStore";
import { hasBuiltinRole, usePermissionSubjectId, usePermissions } from "@/hooks/usePermission";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { useOwnershipContext } from "@/hooks/useOwnershipContext";
import { refuseWhilePreviewing } from "@/services/previewGuard";
import { runTeamAction } from "@/services/teamActionFeedback";
import { isOwnerRole } from "@/components/vault-share/vaultShareModel";
import { resolveVaultAdminTarget } from "@/components/vault-admin/vaultAdminTarget";
import { roleLabel } from "@/components/members/roleChips";
import { compareStrings } from "@/utils/localeFormat";
import { searchMatcher } from "@/utils/search";
import { memberLabel, memberSortKey, memberNamingSupported } from "@/services/memberLabel";
import { memberOwnership } from "@/services/teamOwnership";

export type RoleChangeMode = "assign" | "remove";

export interface MembersModel {
  teamId: string | null;
  localVault: Vault | undefined;
  standaloneTeam: Team | undefined;
  members: TeamMember[];
  roles: TeamRole[];
  pending: PendingInvitation[];
  loading: boolean;
  myUserId: string;
  myMember: TeamMember | undefined;
  canManageMembers: boolean;
  canManageRoles: boolean;
  canInvite: boolean;
  canManageVault: boolean;
  canNameMembers: boolean;
  isOwnerMember(m: TeamMember): boolean;
  outOfReach(m: TeamMember): boolean;
  canActOn(m: TeamMember): boolean;
  canEditMember(m: TeamMember): boolean;
  visible(search: string, roleFilter: string[], sort: SortMode): TeamMember[];
  roleOptions(targets: TeamMember[], mode: RoleChangeMode): TeamRole[];
  changeRole(targets: TeamMember[], role: TeamRole, mode: RoleChangeMode): Promise<void>;
  reload(): Promise<void>;
}

const NO_MEMBERS: TeamMember[] = [];
const NO_ROLES: TeamRole[] = [];
const NO_PENDING: PendingInvitation[] = [];

export function useMembersModel(vaultId: string | null): MembersModel {
  const { t } = useTranslation();
  const vaults = useVaultStore((s) => s.vaults);
  const { teams, loadTeams, membersByTeam, loadMembers, rolesByTeam, loadRoles, pendingInvitationsByTeam, loadPendingInvitations } = useTeamStore();
  const assignMemberRole = useTeamStore((s) => s.assignMemberRole);
  const removeMemberRole = useTeamStore((s) => s.removeMemberRole);
  const push = useHistoryStore((s) => s.push);
  const myUserId = usePermissionSubjectId();
  const can = usePermissions();

  const target = resolveVaultAdminTarget(vaultId, vaults, teams);
  const teamId = target?.teamId ?? null;
  const localVault = target?.kind === "local" ? vaults.find((v) => v.id === target.vaultId) : undefined;
  const standaloneTeam = target?.kind === "cloud" ? teams.find((x) => x.id === target.teamId) : undefined;

  const members = (teamId && membersByTeam[teamId]) || NO_MEMBERS;
  const roles = (teamId && rolesByTeam[teamId]) || NO_ROLES;
  const pending = (teamId && pendingInvitationsByTeam[teamId]) || NO_PENDING;
  const { locked: businessLocked } = useBusinessLock(teamId);
  const myMember = members.find((m) => m.user_id === myUserId);

  const gateVaultId = vaultId ?? "";
  const canManageMembers = can("MANAGE_MEMBERS", gateVaultId);
  const canNameMembers = canManageMembers && memberNamingSupported(members);
  const canManageRoles = can("MANAGE_ROLES", gateVaultId);
  const canManageVault = can("MANAGE_VAULT", gateVaultId) || can("ADMINISTRATOR", gateVaultId);
  const canInvite = can("INVITE_MEMBERS", gateVaultId);

  const isOwnerMember = useCallback((member: TeamMember) => hasBuiltinRole(member, "owner", roles), [roles]);
  const { multiOwner, billingEnabled, billingOwnerId, viewerIsOwner, viewerIsPrimary } = useOwnershipContext(teamId, myMember, roles);
  const outOfReach = useCallback(
    (member: TeamMember) =>
      memberOwnership(
        { multiOwner, billingEnabled, billingOwnerId, viewerIsOwner, viewerIsPrimary },
        { userId: member.user_id, isMe: member.user_id === myUserId, isOwner: isOwnerMember(member) },
      ).protectedFromViewer,
    [multiOwner, billingEnabled, billingOwnerId, viewerIsOwner, viewerIsPrimary, myUserId, isOwnerMember],
  );
  const canActOn = (member: TeamMember) => canManageMembers && !outOfReach(member) && member.user_id !== myUserId;
  const canEditMember = (member: TeamMember) => canNameMembers || canActOn(member);

  useEffect(() => { loadTeams().catch(() => {}); }, [loadTeams]);

  useEffect(() => {
    if (!teamId) return;
    loadMembers(teamId).catch(() => {});
    loadRoles(teamId).catch(() => {});
  }, [teamId, loadMembers, loadRoles]);

  useEffect(() => {
    if (!teamId || !canManageMembers) return;
    loadPendingInvitations(teamId).catch(() => {});
  }, [teamId, canManageMembers, loadPendingInvitations]);

  const reload = useCallback(async () => {
    if (!teamId) return;
    const loads = [loadMembers(teamId)];
    if (canManageMembers) loads.push(loadPendingInvitations(teamId));
    await Promise.all(loads.map((p) => p.catch(() => {})));
  }, [teamId, canManageMembers, loadMembers, loadPendingInvitations]);

  const visible = (search: string, roleFilter: string[], sort: SortMode) => {
    let result = members;
    const query = search.trim();
    if (query) { const match = searchMatcher(query); result = result.filter((m) => match(m.handle, m.member_name)); }
    if (roleFilter.length > 0) result = result.filter((m) => roleFilter.some((rid) => m.role_ids.includes(rid)));
    const position = (m: TeamMember) => Math.min(...m.role_ids.map((rid) => roles.find((r) => r.id === rid)?.position ?? 9999));
    return [...result].sort((a, b) => {
      switch (sort) {
        case "name-asc":  return compareStrings(memberSortKey(a), memberSortKey(b));
        case "name-desc": return compareStrings(memberSortKey(b), memberSortKey(a));
        case "newest":    return b.joined_at.localeCompare(a.joined_at);
        case "oldest":    return a.joined_at.localeCompare(b.joined_at);
        case "role-asc":  return position(a) - position(b) || compareStrings(memberSortKey(a), memberSortKey(b));
        default: return 0;
      }
    });
  };

  const roleOptions = useCallback(
    (targets: TeamMember[], mode: RoleChangeMode) =>
      roles
        .filter((r) => !isOwnerRole(r))
        .sort((a, b) => a.position - b.position)
        .filter((r) => mode === "remove" || !(businessLocked && !r.is_builtin && !targets.every((m) => m.role_ids.includes(r.id)))),
    [roles, businessLocked],
  );

  const changeRole = useCallback(async (targets: TeamMember[], role: TeamRole, mode: RoleChangeMode) => {
    if (!teamId || refuseWhilePreviewing()) return;
    const assigning = mode === "assign";
    const apply = assigning ? assignMemberRole : removeMemberRole;
    const revert = assigning ? removeMemberRole : assignMemberRole;
    const each = (op: typeof apply) =>
      Promise.all(targets.filter((m) => m.role_ids.includes(role.id) !== assigning).map((m) => op(teamId, m.user_id, role.id)));

    const single = targets.length === 1 ? targets[0] : null;
    const vars = { role: roleLabel(t, role.name), name: single ? memberLabel(single) : "" };
    const label = single
      ? t(assigning ? "members.history.assignRole" : "members.history.removeRole", { name: vars.name })
      : t(assigning ? "members.history.assignRoleBulk" : "members.history.removeRoleBulk", { count: targets.length });
    const toast = single
      ? assigning
        ? { pending: t("members.toast.assigningRoleTo", vars), success: t("members.toast.roleAssignedTo", vars) }
        : { pending: t("members.toast.removingRoleFrom", vars), success: t("members.toast.roleRemovedFrom", vars) }
      : { pending: label, success: label };

    try {
      await runTeamAction({ ...toast, run: () => each(apply) });
    } catch {
      return;
    }
    push({
      label,
      undo: async () => { await each(revert); await reload(); },
      redo: async () => { await each(apply); await reload(); },
    });
    await reload();
  }, [teamId, t, push, reload, assignMemberRole, removeMemberRole]);

  return {
    teamId, localVault, standaloneTeam, members, roles, pending,
    loading: !!teamId && members.length === 0,
    myUserId, myMember,
    canManageMembers, canManageRoles, canInvite, canManageVault, canNameMembers,
    isOwnerMember, outOfReach, canActOn, canEditMember,
    visible, roleOptions,
    changeRole,
    reload,
  };
}
