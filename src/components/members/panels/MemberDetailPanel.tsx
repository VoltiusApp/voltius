import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useTeamStore } from "@/stores/teamStore";
import type { TeamMember, TeamRole } from "@/stores/teamStore";
import { useHistoryStore } from "@/stores/historyStore";
import { PanelShell, PanelHeader, FormSection } from "@/components/shared/Panel";
import { runTeamAction } from "@/services/teamActionFeedback";
import { RoleModal } from "@/components/settings/sections/RolesSection";
import { ROLE_META, RoleBlurb } from "@/components/members/roleChips";
import { RoleBadges } from "@/components/members/roleBadges";
import { OffboardingDialog } from "@/components/members/OffboardingDialog";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import type { DepartMode } from "@/services/teamOffboarding";
import {
  PERM_BITS, PERM_META, effectivePermissions, crossesVaultKeyGate, resolveMemberReadOnlyReason,
  type Permission, type MemberReadOnlyReason,
} from "@/services/permissions";
import { checkAndRotateTeamKey } from "@/services/teamKeyRotation";
import {
  PermissionOverrideRow, overrideStateOf, applyOverrideState, type OverrideState,
} from "./PermissionOverrideRow";

export interface MemberDetailPanelProps {
  member: TeamMember;
  isMe: boolean;
  teamId: string;
  teamRoles: TeamRole[];
  canManageMembers: boolean;
  isTargetOwner: boolean;
  viewer?: TeamMember;
  onClose: () => void;
  onUpdated: () => void;
}

const READONLY_REASON_KEYS: Record<MemberReadOnlyReason, string> = {
  noManage: "members.permissions.readOnlyNoManage",
  owner: "members.permissions.readOnlyOwner",
  self: "members.permissions.readOnlySelf",
  higherRole: "members.permissions.readOnlyHigherRole",
  notHeld: "members.permissions.readOnlyNotHeld",
};

export function MemberDetailPanel({
  member, isMe, teamId, teamRoles, canManageMembers, isTargetOwner, viewer, onClose, onUpdated,
}: MemberDetailPanelProps) {
  const { t } = useTranslation();
  const push = useHistoryStore((s) => s.push);

  const [error, setError] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);
  const [justToggled, setJustToggled] = useState<string | null>(null);
  const [offboarding, setOffboarding] = useState<DepartMode | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);
  const [overriding, setOverriding] = useState(false);
  // Stores the intent, not the computed masks — commitOverride recomputes them
  // from the render current at confirm time, in case member state changed meanwhile.
  const [pendingRevoke, setPendingRevoke] = useState<{ permission: Permission; next: OverrideState } | null>(null);

  const canChangeRoles = canManageMembers && !isMe;
  const canRemove = canManageMembers && !isTargetOwner && !isMe;
  // The server rejects an owner removing themselves (teams.rs `is_owner`), so
  // offering Leave to an owner would promise something that 403s.
  const canLeave = isMe && !isTargetOwner;

  const runReversible = async (opts: {
    pending: string;
    success: string;
    label: string;
    run: () => Promise<void>;
    undo: () => Promise<void>;
    redo: () => Promise<void>;
  }) => {
    await runTeamAction({ pending: opts.pending, success: opts.success, run: opts.run });
    push({
      label: opts.label,
      undo: async () => { await opts.undo(); onUpdated(); },
      redo: async () => { await opts.redo(); onUpdated(); },
    });
  };

  const handleToggleRole = async (role: TeamRole) => {
    const hasRole = member.role_ids.includes(role.id);
    if (hasRole && isTargetOwner && role.is_builtin && role.name === "owner") {
      setError(t("members.error.cannotRemoveOwnerRole"));
      return;
    }
    const store = useTeamStore.getState();
    const assign = () => store.assignMemberRole(teamId, member.user_id, role.id);
    const remove = () => store.removeMemberRole(teamId, member.user_id, role.id);

    setToggling(role.id);
    setError("");
    try {
      await runReversible(
        hasRole
          ? {
              pending: t("members.toast.removingRoleFrom", { role: role.name, name: member.handle }),
              success: t("members.toast.roleRemovedFrom", { role: role.name, name: member.handle }),
              label: t("members.history.removeRole", { name: member.handle }),
              run: remove, undo: assign, redo: remove,
            }
          : {
              pending: t("members.toast.assigningRoleTo", { role: role.name, name: member.handle }),
              success: t("members.toast.roleAssignedTo", { role: role.name, name: member.handle }),
              label: t("members.history.assignRole", { name: member.handle }),
              run: assign, undo: remove, redo: assign,
            },
      );
      onUpdated();
      setJustToggled(role.id);
      setTimeout(() => setJustToggled(null), 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("members.error.failedToUpdateRole"));
    } finally {
      setToggling(null);
    }
  };

  const allow = member.permission_allow ?? 0;
  const deny = member.permission_deny ?? 0;
  const viewerEffective = viewer ? effectivePermissions(viewer, teamRoles) : 0;

  // A server predating overrides omits both masks; a zero mask serializes as 0.
  const serverSupportsOverrides =
    member.permission_allow !== undefined || member.permission_deny !== undefined;

  // Retired, but shown when set: otherwise no row can clear it as an offending bit.
  const editablePermissions = (Object.keys(PERM_META) as Permission[])
    .filter((p) => p !== "CREATE_CUSTOM_ROLES"
      || ((allow | deny) & PERM_BITS.CREATE_CUSTOM_ROLES) !== 0);

  const rolesGranting = (permission: Permission) =>
    teamRoles
      .filter((r) => member.role_ids.includes(r.id) && (r.permissions & PERM_BITS[permission]) !== 0)
      .map((r) => r.name);

  const offendingBits = allow & ~viewerEffective;

  const readOnlyReasonKind = resolveMemberReadOnlyReason({
    canManageMembers,
    isTargetOwner,
    isMe,
    viewerRoleIds: viewer ? viewer.role_ids : null,
    targetRoleIds: member.role_ids,
    teamRoles,
    offendingBits,
  });

  const readOnlyReason: string | null = readOnlyReasonKind ? t(READONLY_REASON_KEYS[readOnlyReasonKind]) : null;

  // A whole-mask notHeld lock still lets the admin clear the very bit that
  // caused it — clearing it produces a mask the server accepts.
  const rowDisabled = (permission: Permission) =>
    overriding || pendingRevoke !== null || (readOnlyReasonKind !== null &&
      (readOnlyReasonKind !== "notHeld" || (PERM_BITS[permission] & offendingBits) === 0));

  const write = (masks: { allow: number; deny: number }) => () =>
    useTeamStore.getState().setMemberPermissions(teamId, member.user_id, masks.allow, masks.deny);

  const commitOverride = async (permission: Permission, next: OverrideState, rotate: boolean) => {
    const updated = applyOverrideState(permission, allow, deny, next);
    // Undo/redo re-read the masks so a concurrent admin's unrelated bits survive
    // the full-replace PUT; only the bit this entry owns moves. A member missing
    // from the store can't be safely masked to 0/0 — bail instead of writing empty masks.
    const at = (state: OverrideState) => () => {
      const m = useTeamStore.getState().membersByTeam[teamId]?.find((x) => x.user_id === member.user_id);
      if (!m) throw new Error(t("members.error.failedToUpdatePermissions"));
      const masks = applyOverrideState(permission, m.permission_allow ?? 0, m.permission_deny ?? 0, state);
      return useTeamStore.getState().setMemberPermissions(teamId, member.user_id, masks.allow, masks.deny);
    };
    setError("");
    setOverriding(true);
    try {
      // No toast here: a bit flip already gets its own inline row feedback,
      // and a toast per click was noisy against runReversible's other callers.
      await write(updated)();
      push({
        label: t("members.history.changePermissions", { name: member.handle }),
        undo: at(overrideStateOf(permission, allow, deny)),
        redo: at(next),
      });
      onUpdated();
      if (rotate) void checkAndRotateTeamKey(teamId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("members.error.failedToUpdatePermissions"));
    } finally {
      setOverriding(false);
    }
  };

  const handleOverride = async (permission: Permission, next: OverrideState) => {
    if (next === "allow" && (viewerEffective & PERM_BITS[permission]) === 0) {
      setError(t("members.permissions.readOnlyNotHeld"));
      return;
    }
    const updated = applyOverrideState(permission, allow, deny, next);
    if (crossesVaultKeyGate(member, teamRoles, updated)) {
      setPendingRevoke({ permission, next });
      return;
    }
    await commitOverride(permission, next, false);
  };

  const joinedDate = new Date(member.joined_at).toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric",
  });

  return (
    <>
      {creatingRole && (
        <RoleModal
          teamId={teamId}
          role={null}
          onClose={() => { setCreatingRole(false); onUpdated(); }}
        />
      )}
    <PanelShell>
      <PanelHeader
        icon="lucide:user"
        title={member.handle ?? "?"}
        subtitle={<RoleBadges member={member} roles={teamRoles} />}
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Roles */}
        <FormSection label={t("members.roles")}>
          {canChangeRoles ? (
            <div className="flex flex-wrap items-start gap-2">
              {[...teamRoles]
                .filter((r) => !(r.is_builtin && r.name === "owner"))
                .sort((a, b) => a.position - b.position).map((role) => {

                const hasRole = member.role_ids.includes(role.id);
                const meta = ROLE_META[role.name];
                const color = role.color ?? meta?.color ?? "var(--t-accent)";
                const bg = meta?.bg ?? `${color}1a`;
                return (
                  <div key={role.id} className="flex flex-col gap-1">
                  <button
                    onClick={() => void handleToggleRole(role)}
                    disabled={toggling === role.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{
                      background: justToggled === role.id ? "rgba(52,211,153,0.15)" : hasRole ? bg : "var(--t-bg-elevated)",
                      color: justToggled === role.id ? "#34d399" : hasRole ? color : "var(--t-text-dim)",
                      border: `1px solid ${justToggled === role.id ? "#34d39944" : hasRole ? `${color}44` : "var(--t-border)"}`,
                      opacity: toggling === role.id ? 0.6 : 1,
                      transition: "background 0.3s, color 0.3s, border-color 0.3s",
                    }}
                  >
                    {toggling === role.id
                      ? <Icon icon="lucide:loader-circle" width={10} className="animate-spin" />
                      : justToggled === role.id
                        ? <Icon icon="lucide:check-check" width={10} />
                        : hasRole
                          ? <Icon icon="lucide:check" width={10} />
                          : null
                    }
                    {role.name}
                    {role.is_builtin
                      ? <Icon icon="lucide:lock" width={9} style={{ color: "var(--t-text-dim)", opacity: 0.6 }} />
                      : <Icon icon="lucide:sparkles" width={9} style={{ color: "var(--t-text-dim)", opacity: 0.7 }} />
                    }
                  </button>
                  {hasRole && <RoleBlurb name={role.name} />}
                  </div>
                );
              })}
              <button
                onClick={() => setCreatingRole(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ color: "var(--t-accent)", border: "1px dashed var(--t-accent)", background: "transparent", opacity: 0.7 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.7"; }}
              >
                <Icon icon="lucide:plus" width={10} />
                {t("members.newRole")}
              </button>
            </div>
          ) : (
            <RoleBadges member={member} roles={teamRoles} />
          )}
        </FormSection>

        {/* Permissions */}
        {serverSupportsOverrides && (
        <FormSection label={t("members.permissions.title")}>
          {readOnlyReason && (
            <p className="text-[10px] text-(--t-text-dim) mb-1">{readOnlyReason}</p>
          )}
          <div className="divide-y" style={{ borderColor: "var(--t-border)" }}>
            {editablePermissions.map((permission) => {
              const granting = rolesGranting(permission);
              return (
                <PermissionOverrideRow
                  key={permission}
                  permission={permission}
                  state={overrideStateOf(permission, allow, deny)}
                  inheritedFrom={granting}
                  inheritedGrants={granting.length > 0}
                  disabled={rowDisabled(permission)}
                  onChange={(next) => void handleOverride(permission, next)}
                />
              );
            })}
          </div>
        </FormSection>
        )}

        {/* Info */}
        <FormSection label={t("members.info")}>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-(--t-text-dim)">{t("members.memberSince")}</span>
              <span className="text-(--t-text-primary)">{joinedDate}</span>
            </div>
            {member.invited_by_display_name && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-(--t-text-dim) shrink-0">{t("members.invitedBy")}</span>
                <span className="text-(--t-text-primary) truncate">{member.invited_by_display_name}</span>
              </div>
            )}
          </div>
        </FormSection>

        {/* Danger zone */}
        {(canRemove || canLeave) && (
          <FormSection label={t("members.dangerZone")}>
            <button
              onClick={() => setOffboarding(canLeave ? "leave" : "remove")}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: "var(--t-bg-elevated)",
                color: "var(--t-status-error)",
                border: "1px solid rgba(239,68,68,0.3)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--t-bg-elevated)"; }}
            >
              <Icon icon={canLeave ? "lucide:log-out" : "lucide:user-minus"} width={13} />
              {canLeave ? t("members.leaveTeam") : t("members.removeFromTeam")}
            </button>
          </FormSection>
        )}

        {error && <p className="text-xs px-1" style={{ color: "var(--t-status-error)" }}>{error}</p>}
      </div>
    </PanelShell>

    {offboarding && (
      <OffboardingDialog
        members={[member]}
        teamId={teamId}
        mode={offboarding}
        onClose={() => setOffboarding(null)}
        onDone={() => { onClose(); onUpdated(); }}
      />
    )}

    {pendingRevoke && (
      <ConfirmModal
        tone="warning"
        title={t("members.revokeKeyAccess.title", { name: member.handle ?? "?" })}
        message={t("members.revokeKeyAccess.body", { name: member.handle ?? "?" })}
        confirmLabel={t("members.revokeKeyAccess.confirm")}
        onCancel={() => setPendingRevoke(null)}
        onConfirm={() => {
          const { permission, next } = pendingRevoke;
          setPendingRevoke(null);
          void commitOverride(permission, next, true);
        }}
      />
    )}
    </>
  );
}
