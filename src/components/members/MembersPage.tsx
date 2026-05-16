import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import type { TeamMember, TeamRole } from "@/stores/teamStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useUIStore } from "@/stores/uiStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { useHistoryStore } from "@/stores/historyStore";
import { StatusDot } from "@/components/shared/StatusDot";
import {
  searchUsers,
  getMyUserId,
  getMyEmail,
  inviteByEmail,
  revokePendingInvitation,
} from "@/services/teamService";
import type { PendingInvitation } from "@/stores/teamStore";
import { BaseCard } from "@/components/shared/BaseCard";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { SidePanelLayout } from "@/components/shared/SidePanelLayout";
import { DragSelectSurface } from "@/components/shared/DragSelectSurface";
import { ToolbarViewControls } from "@/components/shared/ToolbarViewControls";
import type { LayoutMode, SortMode } from "@/components/shared/ToolbarViewControls";
import { PanelShell, PanelHeader, PanelHeaderIconButton, FormSection } from "@/components/shared/Panel";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import BuySeatsModal from "@/components/settings/BuySeatsModal";
import { effectivePermissions, hasBuiltinRole, PERM_BITS } from "@/hooks/usePermission";
import { appFetch } from "@/services/http";
import { runTeamAction } from "@/services/teamActionFeedback";
import { markTeamVaultLoadedAfterLocalActivation } from "@/services/teamVaultActivation";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { RoleModal, PERM_META, TeamRolesPanel } from "@/components/settings/sections/RolesSection";

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_META: Record<string, { label: string; color: string; bg: string }> = {
  owner:          { label: "Owner",        color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  manager:        { label: "Manager",      color: "#60a5fa", bg: "rgba(96,165,250,0.12)"  },
  editor:         { label: "Editor",       color: "#34d399", bg: "rgba(52,211,153,0.12)"  },
  member:         { label: "Member",       color: "var(--t-text-secondary)", bg: "var(--t-bg-elevated)" },
  "connect-only": { label: "Connect-Only", color: "#f59e0b", bg: "rgba(245,158,11,0.12)"  },
};

const AVATAR_COLORS = [
  "#6366f1","#8b5cf6","#ec4899","#ef4444",
  "#f59e0b","#10b981","#3b82f6","#14b8a6",
];

function avatarColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function Avatar({ email, size = 32 }: { email: string; size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 font-bold select-none"
      style={{ width: size, height: size, background: avatarColor(email), color: "#fff", fontSize: size * 0.38 }}
    >
      {email[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

function RoleChip({ role }: { role: TeamRole }) {
  const [showTip, setShowTip] = useState(false);
  const meta = ROLE_META[role.name];
  const color = role.color ?? meta?.color ?? avatarColor(role.name);
  const bg = meta?.bg ?? `${color}1a`;

  const grantedPerms = Object.entries(PERM_BITS).filter(([, bit]) => (role.permissions & bit) !== 0);
  const permLabels = grantedPerms.map(([p]) => PERM_META[p as keyof typeof PERM_META]?.label ?? p);

  return (
    <span className="relative inline-flex items-center" style={{ verticalAlign: "middle" }}>
      <span
        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full capitalize shrink-0 cursor-default"
        style={{ color, background: bg }}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
      >
        {role.is_builtin
          ? <Icon icon="lucide:lock" width={8} style={{ opacity: 0.6 }} />
          : <Icon icon="lucide:sparkles" width={8} style={{ opacity: 0.7 }} />
        }
        {role.name}
      </span>
      {showTip && permLabels.length > 0 && (
        <div
          className="absolute bottom-full left-0 mb-1.5 z-50 rounded-lg p-2 text-[10px] min-w-[140px] max-w-[200px] pointer-events-none"
          style={{
            background: "var(--t-bg-card)",
            border: "1px solid var(--t-border)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            color: "var(--t-text-primary)",
          }}
        >
          <p className="font-semibold mb-1 capitalize">{role.name}</p>
          <ul className="space-y-0.5">
            {permLabels.slice(0, 8).map((l) => (
              <li key={l} className="flex items-center gap-1" style={{ color: "var(--t-text-dim)" }}>
                <Icon icon="lucide:check" width={8} style={{ color }} />
                {l}
              </li>
            ))}
            {permLabels.length > 8 && (
              <li style={{ color: "var(--t-text-dim)" }}>+{permLabels.length - 8} more</li>
            )}
          </ul>
        </div>
      )}
    </span>
  );
}

function RoleBadges({
  member, roles, canManage, onAddRole,
}: {
  member: TeamMember;
  roles: TeamRole[];
  canManage?: boolean;
  onAddRole?: () => void;
}) {
  const memberRoles = member.role_ids
    .map((rid) => roles.find((r) => r.id === rid))
    .filter(Boolean) as TeamRole[];
  memberRoles.sort((a, b) => a.position - b.position);
  if (memberRoles.length === 0) {
    if (canManage && onAddRole) {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); onAddRole(); }}
          className="text-[10px] transition-colors"
          style={{ color: "var(--t-text-dim)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-accent)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
        >
          No role · Add →
        </button>
      );
    }
    return <span className="text-[10px] text-[var(--t-text-dim)]">No role</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {memberRoles.map((r) => <RoleChip key={r.id} role={r} />)}
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

interface MembersToolbarProps {
  search: string;
  onSearchChange: (v: string) => void;
  layoutMode: LayoutMode;
  onLayoutModeChange: (v: LayoutMode) => void;
  sortMode: SortMode;
  onSortModeChange: (v: SortMode) => void;
  canInvite: boolean;
  showInvitePanel: boolean;
  onToggleInvite: () => void;
  pendingCount?: number;
  canManageRoles?: boolean;
  showRolesPanel?: boolean;
  onToggleRoles?: () => void;
  selectedCount: number;
  vaultTabs?: { id: string; name: string }[];
  primaryVaultId: string | null;
  onSelectVault: (id: string) => void;
}

function MembersToolbar({
  search, onSearchChange,
  layoutMode, onLayoutModeChange,
  sortMode, onSortModeChange,
  canInvite, showInvitePanel, onToggleInvite,
  pendingCount,
  canManageRoles, showRolesPanel, onToggleRoles,
  selectedCount,
  vaultTabs, primaryVaultId, onSelectVault,
}: MembersToolbarProps) {
  return (
    <div
      className="flex items-center gap-2 px-5 py-2.5 shrink-0"
      style={{ borderBottom: "1px solid var(--t-border)", background: "var(--t-bg-toolbar)" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {vaultTabs && vaultTabs.length > 1 && (
          <div className="flex items-center gap-1 shrink-0">
            {vaultTabs.map(({ id, name }) => (
              <button
                key={id}
                onClick={() => onSelectVault(id)}
                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: id === primaryVaultId ? "var(--t-accent)" : "var(--t-bg-elevated)",
                  color: id === primaryVaultId ? "#fff" : "var(--t-text-dim)",
                }}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        <ToolbarViewControls
          search={search}
          onSearchChange={onSearchChange}
          filterPlaceholder="Filter members…"
          filterShortcutId="filter"
          layoutMode={layoutMode}
          onLayoutModeChange={onLayoutModeChange}
          sortMode={sortMode}
          onSortModeChange={onSortModeChange}
          extraSortOptions={[{ value: "role-asc", label: "By role", icon: "lucide:shield" }]}
          filterWidth={176}
        />
      </div>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        {selectedCount > 1 && (
          <span className="text-xs text-[var(--t-text-dim)] shrink-0">
            {selectedCount} selected
          </span>
        )}

        {canManageRoles && onToggleRoles && (
          <button
            onClick={onToggleRoles}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
            style={{
              background: showRolesPanel ? "color-mix(in srgb, var(--t-accent) 15%, transparent)" : "var(--t-bg-elevated)",
              color: showRolesPanel ? "var(--t-accent)" : "var(--t-text-primary)",
              border: `1px solid ${showRolesPanel ? "var(--t-accent)" : "var(--t-border)"}`,
            }}
          >
            <Icon icon="lucide:shield" width={13} />
            Roles
          </button>
        )}

        {canInvite && (
          <>
            <div className="w-px h-5 self-center bg-[var(--t-border-hover)]" />
            <button
              onClick={onToggleInvite}
              className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
              style={{
                background: showInvitePanel ? "var(--t-accent-hover)" : "var(--t-accent)",
                color: "var(--t-bg-terminal)",
                border: "1px solid var(--t-accent-hover)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-accent-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = showInvitePanel ? "var(--t-accent-hover)" : "var(--t-accent)")}
            >
              <Icon icon="lucide:user-plus" width={13} />
              Invite
              {!!pendingCount && (
                <span
                  className="absolute -top-1.5 -right-1.5 flex items-center justify-center text-[9px] font-bold rounded-full min-w-[16px] h-4 px-0.5"
                  style={{ background: "var(--t-status-error)", color: "#fff" }}
                >
                  {pendingCount}
                </span>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Member card ──────────────────────────────────────────────────────────────

interface MemberCardProps {
  member: TeamMember;
  roles: TeamRole[];
  isMe: boolean;
  isOwner: boolean;
  isSelected: boolean;
  isFocused: boolean;
  layoutMode: LayoutMode;
  canManage?: boolean;
  onAddRole?: () => void;
  onSelect: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
  contextMenuItems: ContextMenuItem[];
  bulkContextMenuItems?: ContextMenuItem[];
}

function MemberAvatar({ member, size }: { member: TeamMember; size: number }) {
  return (
    <div className="relative shrink-0">
      <Avatar email={member.email} size={size} />
      {member.is_online && (
        <StatusDot color="var(--t-status-connected)" animate size={9} />
      )}
    </div>
  );
}

function MemberCard({
  member, roles, isMe, isOwner, isSelected, isFocused, layoutMode,
  canManage, onAddRole,
  onSelect, onDoubleClick, contextMenuItems, bulkContextMenuItems,
}: MemberCardProps) {
  if (layoutMode === "grid") {
    return (
      <BaseCard
        data-selectable-id={member.user_id}
        isSelected={isSelected}
        isFocused={isFocused}
        isList={false}
        onClick={(e) => onSelect(member.user_id, e)}
        onDoubleClick={onDoubleClick}
        contextMenuItems={contextMenuItems}
        bulkContextMenuItems={bulkContextMenuItems}
        className="flex-col items-center text-center gap-2 py-4"
      >
        <div className="relative">
          <MemberAvatar member={member} size={40} />
          {isOwner && (
            <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full" style={{ background: "rgba(167,139,250,0.2)", border: "1px solid rgba(167,139,250,0.35)" }}>
              <Icon icon="lucide:crown" width={8} style={{ color: "#a78bfa" }} />
            </span>
          )}
        </div>
        <div className="w-full min-w-0 flex flex-col items-center gap-1">
          <div className="flex items-center gap-1 justify-center">
            <p className="text-xs font-medium truncate text-[var(--t-text-bright)] max-w-[120px]">{member.email}</p>
            {isMe && (
              <span className="text-[9px] px-1 py-0.5 rounded shrink-0" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>you</span>
            )}
          </div>
          <RoleBadges member={member} roles={roles} canManage={canManage} onAddRole={onAddRole} />
        </div>
      </BaseCard>
    );
  }

  return (
    <BaseCard
      data-selectable-id={member.user_id}
      isSelected={isSelected}
      isFocused={isFocused}
      isList
      onClick={(e) => onSelect(member.user_id, e)}
      onDoubleClick={onDoubleClick}
      contextMenuItems={contextMenuItems}
      bulkContextMenuItems={bulkContextMenuItems}
    >
      <MemberAvatar member={member} size={32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate text-[var(--t-text-bright)]">{member.email}</p>
          {isOwner && <Icon icon="lucide:crown" width={11} style={{ color: "#a78bfa", flexShrink: 0 }} />}
          {isMe && (
            <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>you</span>
          )}
        </div>
      </div>
      <RoleBadges member={member} roles={roles} canManage={canManage} onAddRole={onAddRole} />
    </BaseCard>
  );
}

// ─── Member detail panel ──────────────────────────────────────────────────────

interface MemberDetailPanelProps {
  member: TeamMember;
  isMe: boolean;
  teamId: string;
  teamRoles: TeamRole[];
  canManageMembers: boolean;
  isTargetOwner: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

function MemberDetailPanel({
  member, isMe, teamId, teamRoles, canManageMembers, isTargetOwner, onClose, onUpdated,
}: MemberDetailPanelProps) {
  const assignMemberRole = useTeamStore((s) => s.assignMemberRole);
  const removeMemberRole = useTeamStore((s) => s.removeMemberRole);
  const removeMember = useTeamStore((s) => s.removeMember);
  const push = useHistoryStore((s) => s.push);

  const [error, setError] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);
  const [justToggled, setJustToggled] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);

  const canChangeRoles = canManageMembers && !isMe;
  const canRemove = canManageMembers && !isTargetOwner && !isMe;

  const handleToggleRole = async (role: TeamRole) => {
    const hasRole = member.role_ids.includes(role.id);
    // Block removing the owner role from an owner
    if (hasRole && isTargetOwner && role.is_builtin && role.name === "owner") {
      setError("Cannot remove the owner role from the team owner");
      return;
    }
    setToggling(role.id);
    setError("");
    try {
      if (hasRole) {
        await runTeamAction({
          pending: `Removing ${role.name} from ${member.email}...`,
          success: `${role.name} removed from ${member.email}`,
          run: () => removeMemberRole(teamId, member.user_id, role.id),
        });
        push({
          label: `Remove role: ${member.email}`,
          undo: async () => {
            await useTeamStore.getState().assignMemberRole(teamId, member.user_id, role.id);
            onUpdated();
          },
          redo: async () => {
            await useTeamStore.getState().removeMemberRole(teamId, member.user_id, role.id);
            onUpdated();
          },
        });
      } else {
        await runTeamAction({
          pending: `Assigning ${role.name} to ${member.email}...`,
          success: `${role.name} assigned to ${member.email}`,
          run: () => assignMemberRole(teamId, member.user_id, role.id),
        });
        push({
          label: `Assign role: ${member.email}`,
          undo: async () => {
            await useTeamStore.getState().removeMemberRole(teamId, member.user_id, role.id);
            onUpdated();
          },
          redo: async () => {
            await useTeamStore.getState().assignMemberRole(teamId, member.user_id, role.id);
            onUpdated();
          },
        });
      }
      onUpdated();
      setJustToggled(role.id);
      setTimeout(() => setJustToggled(null), 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role");
    } finally {
      setToggling(null);
    }
  };

  const handleRemove = async () => {
    if (!confirmRemove) { setConfirmRemove(true); return; }
    const snapshot = { ...member };
    setRemoving(true); setError("");
    try {
      await runTeamAction({
        pending: `Removing ${member.email}...`,
        success: `${member.email} removed`,
        run: () => removeMember(teamId, member.user_id),
      });
      push({
        label: `Remove: ${member.email}`,
        undo: async () => {
          await useTeamStore.getState().addMemberById(teamId, snapshot.user_id);
          for (const rid of snapshot.role_ids) {
            await useTeamStore.getState().assignMemberRole(teamId, snapshot.user_id, rid).catch(() => {});
          }
          await useTeamStore.getState().loadMembers(teamId);
        },
        redo: async () => {
          await useTeamStore.getState().removeMember(teamId, snapshot.user_id);
          await useTeamStore.getState().loadMembers(teamId);
        },
      });
      onClose();
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove member");
      setRemoving(false);
      setConfirmRemove(false);
    }
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
        title={member.email}
        subtitle={<RoleBadges member={member} roles={teamRoles} />}
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Roles */}
        <FormSection label="Roles">
          {canChangeRoles ? (
            <div className="flex flex-wrap gap-2">
              {[...teamRoles]
                .filter((r) => !(r.is_builtin && r.name === "owner"))
                .sort((a, b) => a.position - b.position).map((role) => {

                const hasRole = member.role_ids.includes(role.id);
                const meta = ROLE_META[role.name];
                const color = role.color ?? meta?.color ?? "var(--t-accent)";
                const bg = meta?.bg ?? `${color}1a`;
                return (
                  <button
                    key={role.id}
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
                      ? <Icon icon="lucide:loader-2" width={10} className="animate-spin" />
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
                New role
              </button>
            </div>
          ) : (
            <RoleBadges member={member} roles={teamRoles} />
          )}
        </FormSection>

        {/* Info */}
        <FormSection label="Info">
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--t-text-dim)]">Member since</span>
              <span className="text-[var(--t-text-primary)]">{joinedDate}</span>
            </div>
            {member.invited_by_email && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--t-text-dim)] shrink-0">Invited by</span>
                <span className="text-[var(--t-text-primary)] truncate">{member.invited_by_email}</span>
              </div>
            )}
          </div>
        </FormSection>

        {/* Danger zone */}
        {canRemove && (
          <FormSection label="Danger Zone">
            <button
              onClick={() => { if (!removing) void handleRemove(); }}
              disabled={removing}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: confirmRemove ? "#3D1515" : "var(--t-bg-elevated)",
                color: confirmRemove ? "#F87171" : "var(--t-status-error)",
                border: `1px solid ${confirmRemove ? "#5C2020" : "rgba(239,68,68,0.3)"}`,
                opacity: removing ? 0.6 : 1,
              }}
              onMouseEnter={(e) => { if (!confirmRemove) e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
              onMouseLeave={(e) => { if (!confirmRemove) e.currentTarget.style.background = "var(--t-bg-elevated)"; }}
            >
              {removing
                ? <Icon icon="lucide:loader-2" width={13} className="animate-spin" />
                : <Icon icon="lucide:user-minus" width={13} />
              }
              {confirmRemove ? "Click again to confirm removal" : "Remove from team"}
            </button>
          </FormSection>
        )}

        {error && <p className="text-xs px-1" style={{ color: "var(--t-status-error)" }}>{error}</p>}
      </div>
    </PanelShell>
    </>
  );
}

// ─── Pending invite card ──────────────────────────────────────────────────────

function PendingInviteCard({
  inv, teamId, roles, onRevoked,
}: {
  inv: PendingInvitation;
  teamId: string;
  roles: TeamRole[];
  onRevoked: (id: string) => void;
}) {
  const [revoking, setRevoking] = useState(false);

  const handleRevoke = async () => {
    setRevoking(true);
    try {
      await runTeamAction({
        pending: `Revoking invitation for ${inv.email}...`,
        success: `Invitation revoked for ${inv.email}`,
        run: () => revokePendingInvitation(teamId, inv.id),
      });
      onRevoked(inv.id);
    } catch { /* toast already reports the failure */ }
    finally { setRevoking(false); }
  };

  const matchedRole = roles.find((r) => r.name === inv.role);
  const meta = ROLE_META[inv.role] ?? ROLE_META.member;
  const chipColor = matchedRole?.color ?? meta.color;
  const chipBg = meta.bg ?? `${chipColor}1a`;

  return (
    <BaseCard isList>
      <Avatar email={inv.email} size={32} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-[var(--t-text-bright)]">{inv.email}</p>
      </div>
      <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>
        Pending
      </span>
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0" style={{ color: chipColor, background: chipBg }}>
        {inv.role}
      </span>
      <button
        title="Revoke invitation"
        disabled={revoking}
        onClick={(e) => { e.stopPropagation(); void handleRevoke(); }}
        className="p-1.5 hidden group-hover:flex rounded-lg transition-colors"
        style={{ color: "var(--t-text-dim)", opacity: revoking ? 0.4 : 1 }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-status-error)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-dim)")}
      >
        {revoking
          ? <Icon icon="lucide:loader-2" width={16} className="animate-spin" />
          : <Icon icon="lucide:x" width={16} />
        }
      </button>
    </BaseCard>
  );
}

// ─── Invite panel ─────────────────────────────────────────────────────────────

interface SearchResult { user_id: string; email: string; public_key: string; }

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

interface InvitePanelProps {
  teamId: string;
  existingIds: Set<string>;
  teamRoles: TeamRole[];
  onClose: () => void;
  onMemberAdded: () => void;
}

function InvitePanel({ teamId, existingIds, teamRoles, onClose, onMemberAdded }: InvitePanelProps) {
  const addMemberById = useTeamStore((s) => s.addMemberById);
  const assignMemberRole = useTeamStore((s) => s.assignMemberRole);
  const { usedSeats, totalSeats, load: reloadSubscription } = useSubscriptionStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [buySeatsFor, setBuySeatsFor] = useState<SearchResult | null | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAtSeatLimit = totalSeats != null && usedSeats != null && usedSeats >= totalSeats;

  const builtinRoles = useMemo(
    () => teamRoles.filter((r) => !(r.is_builtin && r.name === "owner")).sort((a, b) => a.position - b.position),
    [teamRoles],
  );
  const defaultMemberRoleId = useMemo(
    () => builtinRoles.find((r) => r.is_builtin && r.name === "member")?.id,
    [builtinRoles],
  );
  useEffect(() => {
    if (defaultMemberRoleId && selectedRoleIds.length === 0) {
      setSelectedRoleIds([defaultMemberRoleId]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultMemberRoleId]);

  const toggleRole = (roleId: string) =>
    setSelectedRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  const primaryRoleName = useMemo(
    () => builtinRoles.find((r) => selectedRoleIds.includes(r.id))?.name ?? "member",
    [selectedRoleIds, builtinRoles],
  );
  const selectedRoleLabel = useMemo(() => {
    const names = selectedRoleIds
      .map((id) => builtinRoles.find((r) => r.id === id)?.name)
      .filter(Boolean);
    return names.length > 0 ? names.join(", ") : "no role";
  }, [selectedRoleIds, builtinRoles]);

  useEffect(() => { void reloadSubscription(); }, []);
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    setSearching(true);
    const t = setTimeout(() => {
      searchUsers(query)
        .then((r) => { setResults(r.filter((u) => !existingIds.has(u.user_id))); setOpen(true); })
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, existingIds]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!inputRef.current?.contains(e.target as Node) && !dropdownRef.current?.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const handleAdd = async (user: SearchResult) => {
    if (isAtSeatLimit) { setBuySeatsFor(user); setOpen(false); return; }
    setAdding(user.user_id); setError(""); setSuccess("");
    try {
      const result = await runTeamAction({
        pending: `Inviting ${user.email}...`,
        success: (r) => r.status === "pending" ? `Invitation sent to ${user.email}` : `${user.email} added`,
        run: () => addMemberById(teamId, user.user_id),
      });
      if (result.status === "pending") {
        for (const roleId of selectedRoleIds) {
          await assignMemberRole(teamId, user.user_id, roleId).catch(() => {});
        }
      }
      setQuery(""); setResults([]); setOpen(false);
      setSuccess(result.status === "pending" ? `Invitation sent to ${user.email}` : `${user.email} added`);
      await reloadSubscription();
      onMemberAdded();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if ((e as { code?: number }).code === 402 || err.message.includes("402")) {
        setBuySeatsFor(user); setOpen(false);
      } else {
        setError(err.message);
      }
    } finally { setAdding(null); }
  };

  const handleEmailInvite = async () => {
    if (!isValidEmail(query)) return;
    if (isAtSeatLimit) { setBuySeatsFor(null); return; }
    setSendingInvite(true); setError(""); setSuccess("");
    try {
      const invitedEmail = query;
      const result = await runTeamAction({
        pending: `Inviting ${invitedEmail}...`,
        success: () => `Invitation sent to ${invitedEmail}`,
        run: () => inviteByEmail(teamId, invitedEmail, primaryRoleName),
      });
      void result;
      setQuery(""); setResults([]); setOpen(false);
      setSuccess(`Invitation sent to ${invitedEmail}`);
      await reloadSubscription();
      onMemberAdded();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if ((e as { code?: number }).code === 402 || err.message.includes("402")) {
        setBuySeatsFor(null);
      } else {
        setError(err.message);
      }
    } finally { setSendingInvite(false); }
  };

  const showEmailInviteOption = open && results.length === 0 && !searching && isValidEmail(query);

  return (
    <>
      {buySeatsFor !== undefined && (
        <BuySeatsModal
          teamId={teamId}
          pendingUser={buySeatsFor ?? null}
          pendingRole={primaryRoleName}
          onClose={() => setBuySeatsFor(undefined)}
          onSuccess={async () => {
            setBuySeatsFor(undefined);
            await reloadSubscription();
            onMemberAdded();
          }}
        />
      )}

      <PanelShell>
        <PanelHeader
          icon="lucide:user-plus"
          title="Invite member"
          onClose={onClose}
        />

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Seats usage */}
          <FormSection label="Seats">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: "var(--t-bg-elevated)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: totalSeats ? `${Math.min(100, ((usedSeats ?? 0) / totalSeats) * 100)}%` : "0%",
                      background: isAtSeatLimit ? "var(--t-status-error)" : "var(--t-accent)",
                    }}
                  />
                </div>
                <p className="text-[11px] tabular-nums" style={{ color: isAtSeatLimit ? "var(--t-status-error)" : "var(--t-text-dim)" }}>
                  {usedSeats ?? 0} used · {totalSeats != null ? Math.max(0, totalSeats - (usedSeats ?? 0)) : "?"} available · {totalSeats ?? "?"} total
                </p>
              </div>
              <button
                onClick={() => setBuySeatsFor(null)}
                className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ background: "var(--t-bg-elevated)", color: "var(--t-accent)", border: "1px solid var(--t-border)" }}
              >
                <Icon icon="lucide:plus" width={11} />
                Buy seats
              </button>
            </div>
          </FormSection>

          {/* Role selector */}
          <FormSection label="Initial Roles">
            <div className="flex flex-wrap gap-2">
              {builtinRoles.map((r) => {
                const meta = ROLE_META[r.name];
                const isActive = selectedRoleIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => toggleRole(r.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{
                      background: isActive ? (meta?.bg ?? "var(--t-bg-elevated)") : "var(--t-bg-elevated)",
                      color: isActive ? (meta?.color ?? "var(--t-accent)") : "var(--t-text-dim)",
                      border: `1px solid ${isActive ? `${meta?.color ?? "var(--t-accent)"}44` : "var(--t-border)"}`,
                    }}
                  >
                    {isActive && <Icon icon="lucide:check" width={9} />}
                    {r.name}
                  </button>
                );
              })}
            </div>
          </FormSection>

          {/* Search input */}
          <FormSection label="Search or enter email" className="overflow-visible">
            <div className="relative">
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors"
                style={{ background: "var(--t-bg-input)", borderColor: open ? "var(--t-accent)" : "var(--t-border)" }}
              >
                {searching
                  ? <Icon icon="lucide:loader-2" width={14} className="animate-spin shrink-0 text-[var(--t-text-dim)]" />
                  : <Icon icon="lucide:search" width={14} className="shrink-0 text-[var(--t-text-dim)]" />
                }
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search by email…"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setSuccess(""); }}
                  onFocus={() => { if (results.length > 0 || showEmailInviteOption) setOpen(true); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && isValidEmail(query) && results.length === 0) void handleEmailInvite(); }}
                  className="flex-1 bg-transparent outline-none text-sm text-[var(--t-text-primary)]"
                />
                {query && (
                  <button onClick={() => { setQuery(""); setResults([]); setOpen(false); setSuccess(""); }}>
                    <Icon icon="lucide:x" width={11} style={{ color: "var(--t-text-dim)" }} />
                  </button>
                )}
              </div>

              {open && (results.length > 0 || showEmailInviteOption) && (
                <div
                  ref={dropdownRef}
                  className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-hidden"
                  style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}
                >
                  {results.map((user) => (
                    <button
                      key={user.user_id}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                      style={{ color: "var(--t-text-primary)" }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
                      disabled={!!adding}
                      onClick={() => void handleAdd(user)}
                    >
                      <Avatar email={user.email} size={26} />
                      <span className="flex-1 text-sm truncate">{user.email}</span>
                      {adding === user.user_id
                        ? <Icon icon="lucide:loader-2" width={13} className="animate-spin shrink-0" style={{ color: "var(--t-text-dim)" }} />
                        : <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: "var(--t-accent)", color: "#fff" }}>
                            Add ({selectedRoleLabel})
                          </span>
                      }
                    </button>
                  ))}
                  {showEmailInviteOption && (
                    <button
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                      style={{ color: "var(--t-text-primary)", borderTop: results.length > 0 ? "1px solid var(--t-border)" : undefined }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
                      disabled={sendingInvite}
                      onClick={() => void handleEmailInvite()}
                    >
                      <Icon icon="lucide:mail" width={16} className="shrink-0" style={{ color: "var(--t-accent)" }} />
                      <span className="flex-1 text-sm">
                        Send invite to <span className="font-medium">{query}</span>
                      </span>
                      {sendingInvite
                        ? <Icon icon="lucide:loader-2" width={13} className="animate-spin shrink-0" style={{ color: "var(--t-text-dim)" }} />
                        : <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: "var(--t-accent)", color: "#fff" }}>
                            Invite →
                          </span>
                      }
                    </button>
                  )}
                </div>
              )}
            </div>
          </FormSection>

          {error && <p className="text-xs px-1" style={{ color: "var(--t-status-error)" }}>{error}</p>}
          {success && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)" }}>
              <Icon icon="lucide:check-circle-2" width={14} style={{ color: "#34d399" }} />
              <p className="text-xs" style={{ color: "#34d399" }}>{success}</p>
            </div>
          )}
        </div>
      </PanelShell>
    </>
  );
}

// ─── Private vault invite panel ───────────────────────────────────────────────

const PRIVATE_VAULT_ROLES = ["manager", "editor", "member", "connect-only"] as const;

function PrivateVaultInvitePanel({
  query, onQueryChange,
  results, searching, open, setOpen,
  adding, error,
  inputRef, dropdownRef,
  onAdd, onClose,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  results: { user_id: string; email: string; public_key: string }[];
  searching: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
  adding: string | null;
  error: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  onAdd: (user: { user_id: string; email: string; public_key: string }, roleName: string) => void;
  onClose: () => void;
}) {
  const { usedSeats, totalSeats, load: reloadSubscription } = useSubscriptionStore();
  const [selectedRole, setSelectedRole] = useState("member");
  const isAtSeatLimit = totalSeats != null && usedSeats != null && usedSeats >= totalSeats;

  useEffect(() => { void reloadSubscription(); }, []);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <PanelShell>
      <PanelHeader icon="lucide:user-plus" title="Invite member" onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Seats */}
        <FormSection label="Seats">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: "var(--t-bg-elevated)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: totalSeats ? `${Math.min(100, ((usedSeats ?? 0) / totalSeats) * 100)}%` : "0%",
                    background: isAtSeatLimit ? "var(--t-status-error)" : "var(--t-accent)",
                  }}
                />
              </div>
              <p className="text-[11px] tabular-nums" style={{ color: isAtSeatLimit ? "var(--t-status-error)" : "var(--t-text-dim)" }}>
                {usedSeats ?? 0} used · {totalSeats != null ? Math.max(0, totalSeats - (usedSeats ?? 0)) : "?"} available · {totalSeats ?? "?"} total
              </p>
            </div>
          </div>
        </FormSection>

        {/* Role selector */}
        <FormSection label="Initial Role">
          <div className="flex flex-wrap gap-2">
            {PRIVATE_VAULT_ROLES.map((name) => {
              const meta = ROLE_META[name];
              const isActive = selectedRole === name;
              return (
                <button
                  key={name}
                  onClick={() => setSelectedRole(name)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: isActive ? (meta?.bg ?? "var(--t-bg-elevated)") : "var(--t-bg-elevated)",
                    color: isActive ? (meta?.color ?? "var(--t-accent)") : "var(--t-text-dim)",
                    border: `1px solid ${isActive ? `${meta?.color ?? "var(--t-accent)"}44` : "var(--t-border)"}`,
                  }}
                >
                  {isActive && <Icon icon="lucide:check" width={9} />}
                  {name}
                </button>
              );
            })}
          </div>
        </FormSection>

        {/* Search input */}
        <FormSection label="Search by email" className="overflow-visible">
          <div className="relative">
            <div
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors"
              style={{ background: "var(--t-bg-input)", borderColor: open ? "var(--t-accent)" : "var(--t-border)" }}
            >
              {searching
                ? <Icon icon="lucide:loader-2" width={14} className="animate-spin shrink-0 text-[var(--t-text-dim)]" />
                : <Icon icon="lucide:search" width={14} className="shrink-0 text-[var(--t-text-dim)]" />
              }
              <input
                ref={inputRef}
                type="text"
                placeholder="Search by email…"
                value={query}
                onChange={(e) => { onQueryChange(e.target.value); }}
                onFocus={() => { if (results.length > 0) setOpen(true); }}
                className="flex-1 bg-transparent outline-none text-sm text-[var(--t-text-primary)]"
              />
              {query && (
                <button onClick={() => { onQueryChange(""); setOpen(false); }}>
                  <Icon icon="lucide:x" width={11} style={{ color: "var(--t-text-dim)" }} />
                </button>
              )}
            </div>
            {open && results.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-hidden"
                style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}
              >
                {results.map((user) => (
                  <button
                    key={user.user_id}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                    style={{ color: "var(--t-text-primary)" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
                    disabled={!!adding}
                    onClick={() => onAdd(user, selectedRole)}
                  >
                    <Avatar email={user.email} size={26} />
                    <span className="flex-1 text-sm truncate">{user.email}</span>
                    {adding === user.user_id
                      ? <Icon icon="lucide:loader-2" width={13} className="animate-spin shrink-0" style={{ color: "var(--t-text-dim)" }} />
                      : <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: "var(--t-accent)", color: "#fff" }}>
                          Add as {selectedRole}
                        </span>
                    }
                  </button>
                ))}
              </div>
            )}
          </div>
        </FormSection>

        {error && <p className="text-xs px-1" style={{ color: "var(--t-status-error)" }}>{error}</p>}
      </div>
    </PanelShell>
  );
}

// ─── Upgrade CTA ──────────────────────────────────────────────────────────────

function SignInToCloudCTA({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[320px] gap-5">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
        <Icon icon="lucide:cloud" width={28} style={{ color: "var(--t-accent)" }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium mb-1 text-[var(--t-text-primary)]">Sign in to use team features</p>
        <p className="text-xs max-w-[240px] text-[var(--t-text-dim)]">
          Members, invites, and shared vault access require a cloud account before you can upgrade or manage a team.
        </p>
      </div>
      <button
        onClick={onSignIn}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: "var(--t-accent)" }}
      >
        Sign in or create cloud account →
      </button>
    </div>
  );
}

function UpgradeToTeamsCTA() {
  const openCheckout = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { open } = await import("@tauri-apps/plugin-shell");
    const serverUrl = await invoke<string | null>("keychain_get", { key: "server_url" });
    const jwt = await invoke<string | null>("keychain_get", { key: "jwt" });
    if (!serverUrl || !jwt) return;
    const res = await appFetch(`${serverUrl}/v1/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ plan: "teams" }),
    });
    if (!res.ok) return;
    const { checkout_url } = await res.json() as { checkout_url: string };
    await open(checkout_url);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[320px] gap-5">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
        <Icon icon="lucide:users-round" width={28} style={{ color: "var(--t-accent)" }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium mb-1 text-[var(--t-text-primary)]">Team Vaults require Teams</p>
        <p className="text-xs max-w-[220px] text-[var(--t-text-dim)]">
          Invite members, assign roles, and share credentials securely with your team.
        </p>
      </div>
      <button
        onClick={() => void openCheckout()}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: "var(--t-accent)" }}
      >
        Upgrade to Teams →
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MembersPage() {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const { teams, loadTeams, membersByTeam, loadMembers, rolesByTeam, loadRoles, pendingInvitationsByTeam, loadPendingInvitations } = useTeamStore();
  const { isTeams, accountMode } = useSubscriptionStore();
  const { createTeam } = useTeamStore();
  const { setVaultTeamId } = useVaultStore();
  const addMemberById = useTeamStore((s) => s.addMemberById);
  const assignMemberRole = useTeamStore((s) => s.assignMemberRole);
  const removeMemberRole = useTeamStore((s) => s.removeMemberRole);
  const removeMember = useTeamStore((s) => s.removeMember);
  const push = useHistoryStore((s) => s.push);
  const { activeSessions } = useTeamSessionStore();

  const layoutMode = useUIStore((s) => s.membersLayoutMode);
  const sortMode = useUIStore((s) => s.membersSortMode);
  const setLayoutMode = useUIStore((s) => s.setMembersLayoutMode);
  const setSortMode = useUIStore((s) => s.setMembersSortMode);
  const membersInvitePending = useUIStore((s) => s.membersInvitePending);
  const clearMembersInvitePending = useUIStore((s) => s.clearMembersInvitePending);
  const openSettings = useUIStore((s) => s.openSettings);
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);

  const [myUserId, setMyUserId] = useState("");
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [primaryVaultId, setPrimaryVaultId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showRolesPanel, setShowRolesPanel] = useState(false);
  const [transferOwnerTarget, setTransferOwnerTarget] = useState<TeamMember | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState("");

  useEffect(() => {
    if (membersInvitePending) {
      setShowInvitePanel(true);
      setShowDetailPanel(false);
      clearMembersInvitePending();
    }
  }, [membersInvitePending, clearMembersInvitePending]);
  const [detailMemberId, setDetailMemberId] = useState<string | null>(null);

  // Private-vault invite state
  const [privateQuery, setPrivateQuery] = useState("");
  const [privateResults, setPrivateResults] = useState<{ user_id: string; email: string; public_key: string }[]>([]);
  const [privateSearching, setPrivateSearching] = useState(false);
  const [privateOpen, setPrivateOpen] = useState(false);
  const [privateAdding, setPrivateAdding] = useState<string | null>(null);
  const [privateError, setPrivateError] = useState("");
  const privateInputRef = useRef<HTMLInputElement>(null);
  const privateDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getMyUserId().then((id) => { if (id) setMyUserId(id); }).catch(() => {});
    getMyEmail().then((email) => { setMyEmail(email ?? ""); }).catch(() => { setMyEmail(""); });
    loadTeams().catch(() => {});
  }, [loadTeams]);

  useEffect(() => {
    if (selectedVaultIds.length > 0) {
      setPrimaryVaultId((prev) =>
        selectedVaultIds.includes(prev ?? "") ? prev : selectedVaultIds[0]
      );
    } else {
      setPrimaryVaultId(null);
    }
  }, [selectedVaultIds]);

  const localVault = primaryVaultId ? vaults.find((v) => v.id === primaryVaultId) : null;
  const standaloneTeam = !localVault && primaryVaultId ? teams.find((t) => t.id === primaryVaultId) : null;
  const teamId = localVault?.teamId ?? standaloneTeam?.id ?? null;
  const pendingInvites = pendingInvitationsByTeam[teamId ?? ""] ?? [];

  const members = useMemo(() => (teamId ? (membersByTeam[teamId] ?? []) : []), [teamId, membersByTeam]);
  const teamRoles = useMemo(() => (teamId ? (rolesByTeam[teamId] ?? []) : []), [teamId, rolesByTeam]);
  const myMember = members.find((m) => m.user_id === myUserId);

  // Compute effective permissions from role bits
  const myEffectivePerms = myMember ? effectivePermissions(myMember, teamRoles) : 0;
  const canManageMembers = (myEffectivePerms & PERM_BITS.MANAGE_MEMBERS) !== 0;
  const canManageRoles = (myEffectivePerms & PERM_BITS.MANAGE_ROLES) !== 0;
  const canInvite = (myEffectivePerms & PERM_BITS.INVITE_MEMBERS) !== 0;

  const isOwnerMember = (member: TeamMember) =>
    hasBuiltinRole(member, "owner", teamRoles);

  const existingMemberIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);

  const reload = () => {
    if (!teamId) return;
    loadMembers(teamId).catch(() => {});
    if (canManageMembers) {
      loadPendingInvitations(teamId).catch(() => {});
    }
  };

  useEffect(() => {
    if (!teamId) return;
    loadMembers(teamId).catch(() => {});
    loadRoles(teamId).catch(() => {});
  }, [teamId, loadMembers, loadRoles]);

  useEffect(() => {
    if (!teamId || !canManageMembers) return;
    loadPendingInvitations(teamId).catch(() => {});
  }, [teamId, canManageMembers, loadPendingInvitations]);

  // Private vault search
  useEffect(() => {
    if (privateQuery.length < 2) { setPrivateResults([]); setPrivateOpen(false); return; }
    setPrivateSearching(true);
    const t = setTimeout(() => {
      searchUsers(privateQuery)
        .then((r) => { setPrivateResults(r); setPrivateOpen(true); })
        .catch(() => {})
        .finally(() => setPrivateSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [privateQuery]);

  useEffect(() => {
    if (!privateOpen) return;
    const h = (e: MouseEvent) => {
      if (!privateInputRef.current?.contains(e.target as Node) && !privateDropdownRef.current?.contains(e.target as Node))
        setPrivateOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [privateOpen]);

  const handlePrivateAdd = async (user: { user_id: string; email: string; public_key: string }, roleName: string) => {
    if (!localVault || !primaryVaultId) return;
    setPrivateAdding(user.user_id); setPrivateError("");
    try {
      const team = await createTeam(localVault.name);
      setVaultTeamId(primaryVaultId, team.id);
      const { initTeamVaultKey } = await import("@/services/teamVaultSync");
      await initTeamVaultKey(team.id, []);
      markTeamVaultLoadedAfterLocalActivation(team.id, useTeamVaultStateStore.getState());
      await addMemberById(team.id, user.user_id);
      await loadRoles(team.id);
      const role = useTeamStore.getState().rolesByTeam[team.id]?.find(
        (r) => r.is_builtin && r.name === roleName,
      );
      if (role) {
        await assignMemberRole(team.id, user.user_id, role.id);
      }
      setPrivateQuery(""); setPrivateResults([]); setPrivateOpen(false);
    } catch (e) {
      setPrivateError(e instanceof Error ? e.message : "Failed to add member");
    } finally { setPrivateAdding(null); }
  };

  // Filter + sort
  const searchLower = search.trim().toLowerCase();
  const filteredMembers = useMemo(() => {
    let result = members;
    if (searchLower) result = result.filter((m) => m.email.toLowerCase().includes(searchLower));
    if (roleFilter.length > 0) result = result.filter((m) => roleFilter.some((rid) => m.role_ids.includes(rid)));
    return result;
  }, [members, searchLower, roleFilter]);

  const sortedMembers = useMemo(() => {
    return [...filteredMembers].sort((a, b) => {
      switch (sortMode) {
        case "name-asc":  return a.email.localeCompare(b.email);
        case "name-desc": return b.email.localeCompare(a.email);
        case "newest":    return b.joined_at.localeCompare(a.joined_at);
        case "oldest":    return a.joined_at.localeCompare(b.joined_at);
        case "role-asc": {
          const posA = Math.min(...(a.role_ids.map((rid) => teamRoles.find((r) => r.id === rid)?.position ?? 9999)));
          const posB = Math.min(...(b.role_ids.map((rid) => teamRoles.find((r) => r.id === rid)?.position ?? 9999)));
          if (posA !== posB) return posA - posB;
          return a.email.localeCompare(b.email);
        }
        default: return 0;
      }
    });
  }, [filteredMembers, sortMode, teamRoles]);

  const orderedIds = useMemo(() => sortedMembers.map((m) => m.user_id), [sortedMembers]);

  const {
    selectedIdSet, selectionAreaRef, itemAreaRef, dragBox,
    handleItemSelect, handleSelectionAreaMouseDown,
    selectSingle, setSelection,
  } = useDragSelection(orderedIds);

  const detailMember = detailMemberId ? members.find((m) => m.user_id === detailMemberId) ?? null : null;

  const { focusedId } = useListKeyNav({
    orderedIds,
    selectedIdSet,
    selectSingle,
    setSelection,
    itemAreaRef,
    layoutMode,
    onEnter: (id) => { setDetailMemberId(id); setShowDetailPanel(true); setShowInvitePanel(false); },
    onEdit: (id) => { setDetailMemberId(id); setShowDetailPanel(true); setShowInvitePanel(false); },
    onEscape: () => { setShowDetailPanel(false); setShowInvitePanel(false); },
  });

  // Context menu builders
  const buildContextMenuItems = (member: TeamMember): ContextMenuItem[] => {
    const canActOnMember = canManageMembers && !isOwnerMember(member) && member.user_id !== myUserId;
    const items: ContextMenuItem[] = [];

    if (canActOnMember && teamRoles.length > 0) {
      const sortedRoles = [...teamRoles]
        .filter((r) => !(r.is_builtin && r.name === "owner"))
        .sort((a, b) => a.position - b.position);
      const assignedRoles = sortedRoles.filter((r) => member.role_ids.includes(r.id));
      const unassignedRoles = sortedRoles.filter((r) => !member.role_ids.includes(r.id));

      const assignedItems: ContextMenuItem[] = assignedRoles.map((r) => ({
        label: r.name,
        icon: "lucide:check-square",
        onClick: () => {
          void removeMemberRole(teamId!, member.user_id, r.id).then(() => {
            push({
              label: `Remove role: ${member.email}`,
              undo: async () => { await assignMemberRole(teamId!, member.user_id, r.id); reload(); },
              redo: async () => { await removeMemberRole(teamId!, member.user_id, r.id); reload(); },
            });
            reload();
          });
        },
      }));

      const unassignedItems: ContextMenuItem[] = unassignedRoles.map((r, i) => ({
        label: r.name,
        icon: "lucide:square",
        divider: i === 0 && assignedItems.length > 0,
        onClick: () => {
          void assignMemberRole(teamId!, member.user_id, r.id).then(() => {
            push({
              label: `Assign role: ${member.email}`,
              undo: async () => { await removeMemberRole(teamId!, member.user_id, r.id); reload(); },
              redo: async () => { await assignMemberRole(teamId!, member.user_id, r.id); reload(); },
            });
            reload();
          });
        },
      }));

      const roleChildren = [...assignedItems, ...unassignedItems];
      if (roleChildren.length > 0) {
        items.push({
          label: "Roles",
          icon: "lucide:shield",
          children: roleChildren,
        });
      }
    }

    // Transfer ownership — only shown to the current owner, only for non-owner members
    if (myMember && isOwnerMember(myMember) && canActOnMember) {
      items.push({
        label: "Transfer Ownership",
        icon: "lucide:crown",
        divider: items.length > 0,
        onClick: () => setTransferOwnerTarget(member),
      });
    }

    items.push({
      label: "Invite to Session",
      icon: "lucide:terminal",
      children: activeSessions.length > 0
        ? activeSessions.map((s) => ({
            label: s.connection_name,
            onClick: () => {
              void useTeamSessionStore.getState().startSharing(
                s.id,
                teamId ? [teamId] : [],
                ["owner", "manager", "editor", "member"],
                s.connection_name,
                [member],
              );
            },
          }))
        : [{ label: "No active sessions", onClick: () => {} }],
    });

    if (canActOnMember) {
      items.push({
        label: "Kick",
        icon: "lucide:user-minus",
        danger: true,
        divider: true,
        onClick: () => {
          const snapshot = { ...member };
          void removeMember(teamId!, member.user_id).then(() => {
            push({
              label: `Remove: ${member.email}`,
              undo: async () => {
                await addMemberById(teamId!, snapshot.user_id);
                for (const rid of snapshot.role_ids) {
                  await assignMemberRole(teamId!, snapshot.user_id, rid).catch(() => {});
                }
                reload();
              },
              redo: async () => { await removeMember(teamId!, snapshot.user_id); reload(); },
            });
            reload();
          });
        },
      });
    }

    return items;
  };

  const bulkContextMenuItems = useMemo((): ContextMenuItem[] | undefined => {
    if (selectedIdSet.size <= 1) return undefined;
    const selectedMembers = sortedMembers.filter((m) =>
      selectedIdSet.has(m.user_id) && m.user_id !== myUserId && !isOwnerMember(m)
    );
    if (selectedMembers.length === 0) return undefined;

    const items: ContextMenuItem[] = [];

    if (canManageMembers && teamRoles.length > 0) {
      const sortedBulkRoles = [...teamRoles]
        .filter((r) => !(r.is_builtin && r.name === "owner"))
        .sort((a, b) => a.position - b.position);
      items.push({
        label: `Assign Role (${selectedMembers.length})`,
        icon: "lucide:shield",
        children: sortedBulkRoles.map((r) => ({
          label: r.name,
          onClick: () => {
            const prevRoleIds = selectedMembers.map((m) => ({ userId: m.user_id, roleIds: [...m.role_ids] }));
            void Promise.all(selectedMembers.map((m) => assignMemberRole(teamId!, m.user_id, r.id))).then(() => {
              push({
                label: `Assign role ×${selectedMembers.length}`,
                undo: async () => {
                  await Promise.all(prevRoleIds.map(({ userId }) => removeMemberRole(teamId!, userId, r.id)));
                  reload();
                },
                redo: async () => {
                  await Promise.all(selectedMembers.map((m) => assignMemberRole(teamId!, m.user_id, r.id)));
                  reload();
                },
              });
              reload();
            });
          },
        })),
      });

      items.push({
        label: `Remove Role (${selectedMembers.length})`,
        icon: "lucide:shield-off",
        children: sortedBulkRoles.map((r) => ({
          label: r.name,
          onClick: () => {
            void Promise.all(
              selectedMembers
                .filter((m) => m.role_ids.includes(r.id))
                .map((m) => removeMemberRole(teamId!, m.user_id, r.id))
            ).then(() => {
              push({
                label: `Remove role ×${selectedMembers.length}`,
                undo: async () => {
                  await Promise.all(
                    selectedMembers.filter((m) => m.role_ids.includes(r.id)).map((m) => assignMemberRole(teamId!, m.user_id, r.id))
                  );
                  reload();
                },
                redo: async () => {
                  await Promise.all(
                    selectedMembers.filter((m) => m.role_ids.includes(r.id)).map((m) => removeMemberRole(teamId!, m.user_id, r.id))
                  );
                  reload();
                },
              });
              reload();
            });
          },
        })),
      });
    }

    if (canManageMembers) {
      items.push({
        label: `Kick ${selectedMembers.length} members`,
        icon: "lucide:user-minus",
        danger: true,
        divider: items.length > 0,
        onClick: () => {
          const snapshots = selectedMembers.map((m) => ({ ...m }));
          void Promise.all(selectedMembers.map((m) => removeMember(teamId!, m.user_id))).then(() => {
            push({
              label: `Remove ×${selectedMembers.length}`,
              undo: async () => {
                await Promise.all(snapshots.map((m) => addMemberById(teamId!, m.user_id)));
                await Promise.all(
                  snapshots.flatMap((m) => m.role_ids.map((rid) => assignMemberRole(teamId!, m.user_id, rid).catch(() => {})))
                );
                reload();
              },
              redo: async () => {
                await Promise.all(snapshots.map((m) => removeMember(teamId!, m.user_id)));
                reload();
              },
            });
            reload();
          });
        },
      });
    }

    return items.length > 0 ? items : undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdSet, sortedMembers, myUserId, canManageMembers, teamRoles, teamId]);

const vaultTabs = selectedVaultIds.length > 1
    ? selectedVaultIds.map((vid) => {
        const v = vaults.find((x) => x.id === vid) ?? teams.find((t) => t.id === vid);
        return { id: vid, name: v ? v.name : vid };
      })
    : undefined;

  // ── No vault selected ──────────────────────────────────────────────────────
  if (!primaryVaultId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-[var(--t-bg-base)]">
        <div
          className="flex items-center justify-center rounded-3xl w-[5.333rem] h-[5.333rem] text-[var(--t-text-dim)]"
          style={{
            background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)",
            border: "1px solid var(--t-border)",
          }}
        >
          <Icon icon="lucide:users-round" width={36} />
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <span className="text-base font-semibold text-[var(--t-text-primary)]">No vault selected</span>
          <span className="text-sm text-[var(--t-text-dim)] max-w-[18.667rem]">
            Select a vault in the sidebar to manage its members.
          </span>
        </div>
      </div>
    );
  }

  // ── Private vault (no team yet) ────────────────────────────────────────────
  if (localVault && !teamId) {
    const isCloudAccount = accountMode === "server";
    const canPrivateInvite = isCloudAccount && isTeams && !!myUserId;

    const toolbar = (
      <MembersToolbar
        search={search}
        onSearchChange={setSearch}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        canInvite={canPrivateInvite}
        showInvitePanel={showInvitePanel}
        onToggleInvite={() => { setShowInvitePanel((p) => !p); }}
        selectedCount={0}
        vaultTabs={vaultTabs}
        primaryVaultId={primaryVaultId}
        onSelectVault={setPrimaryVaultId}
      />
    );

    if (!isCloudAccount) {
      return (
        <div className="flex-1 flex flex-col bg-[var(--t-bg-base)]">
          {toolbar}
          <SignInToCloudCTA onSignIn={() => openCloudAuth("signin")} />
        </div>
      );
    }

    if (!isTeams) {
      return (
        <div className="flex-1 flex flex-col bg-[var(--t-bg-base)]">
          {toolbar}
          <UpgradeToTeamsCTA />
        </div>
      );
    }
    if (!myUserId) {
      return (
        <div className="flex-1 flex flex-col bg-[var(--t-bg-base)]">
          {toolbar}
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <Icon icon="lucide:users-round" width={28} style={{ color: "var(--t-text-dim)" }} />
            <p className="text-sm text-[var(--t-text-dim)]">Sign in to invite teammates to this vault.</p>
          </div>
        </div>
      );
    }

    return (
      <SidePanelLayout
        panelOpen={showInvitePanel}
        panelWidth={320}
        panel={showInvitePanel ? (
          <PrivateVaultInvitePanel
            query={privateQuery}
            onQueryChange={(v) => { setPrivateQuery(v); setPrivateError(""); }}
            results={privateResults}
            searching={privateSearching}
            open={privateOpen}
            setOpen={setPrivateOpen}
            adding={privateAdding}
            error={privateError}
            inputRef={privateInputRef}
            dropdownRef={privateDropdownRef}
            onAdd={(user, roleName) => void handlePrivateAdd(user, roleName)}
            onClose={() => setShowInvitePanel(false)}
          />
        ) : null}
        className="bg-[var(--t-bg-base)]"
      >
        <div className="flex flex-col h-full">
          {toolbar}
          <div className="flex-1 overflow-y-auto px-9 pt-5 pb-9">
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">Members</p>
            <div
              className={layoutMode === "grid" ? "grid gap-3" : "flex flex-col gap-1.5"}
              style={layoutMode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" } : undefined}
            >
              {layoutMode === "grid" ? (
                <BaseCard isList={false} className="flex-col items-center text-center gap-2 py-4">
                  <Avatar email={myEmail || "?"} size={40} />
                  <div className="w-full min-w-0 flex flex-col items-center gap-1">
                    <div className="flex items-center gap-1 justify-center">
                      {myEmail === null
                        ? <div className="h-3.5 w-20 rounded animate-pulse" style={{ background: "var(--t-bg-elevated)" }} />
                        : <p className="text-xs font-medium truncate text-[var(--t-text-bright)] max-w-[120px]">{myEmail || "You"}</p>
                      }
                      <span className="text-[9px] px-1 py-0.5 rounded shrink-0" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>you</span>
                    </div>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ color: "#a78bfa", background: "rgba(167,139,250,0.12)" }}>owner</span>
                  </div>
                </BaseCard>
              ) : (
                <BaseCard isList>
                  <Avatar email={myEmail || "?"} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {myEmail === null
                        ? <div className="h-3.5 w-40 rounded animate-pulse" style={{ background: "var(--t-bg-elevated)" }} />
                        : <p className="text-sm font-medium truncate text-[var(--t-text-bright)]">{myEmail || "You"}</p>
                      }
                      <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>
                        you
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ color: "#a78bfa", background: "rgba(167,139,250,0.12)" }}>owner</span>
                </BaseCard>
              )}
            </div>
          </div>
        </div>
        </div>
      </SidePanelLayout>
    );
  }

  // ── Vault not found ────────────────────────────────────────────────────────
  if (!teamId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center bg-[var(--t-bg-base)]">
        <Icon icon="lucide:vault" width={28} style={{ color: "var(--t-text-dim)" }} />
        <p className="text-sm text-[var(--t-text-dim)]">Vault not found.</p>
      </div>
    );
  }

  // ── Team vault ─────────────────────────────────────────────────────────────
  const panelOpen = showDetailPanel || showInvitePanel || showRolesPanel;

  const handleTransferOwnership = async () => {
    if (!transferOwnerTarget || !teamId || !myMember) return;
    const ownerRole = teamRoles.find((r) => r.is_builtin && r.name === "owner");
    if (!ownerRole) return;
    setTransferring(true);
    setTransferError("");
    try {
      await runTeamAction({
        pending: `Transferring ownership to ${transferOwnerTarget.email}…`,
        success: `Ownership transferred to ${transferOwnerTarget.email}`,
        run: async () => {
          await assignMemberRole(teamId, transferOwnerTarget.user_id, ownerRole.id);
          await removeMemberRole(teamId, myMember.user_id, ownerRole.id);
        },
      });
      setTransferOwnerTarget(null);
      reload();
    } catch (e) {
      setTransferError(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setTransferring(false);
    }
  };

  return (
    <>
      {transferOwnerTarget && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => { if (!transferring) { setTransferOwnerTarget(null); setTransferError(""); } }}
        >
          <div
            className="rounded-2xl p-6 w-[400px] max-w-[90vw] space-y-4"
            style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(167,139,250,0.15)" }}>
                <Icon icon="lucide:crown" width={18} style={{ color: "#a78bfa" }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--t-text-bright)" }}>Transfer Ownership</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--t-text-dim)" }}>This is a critical, irreversible action</p>
              </div>
            </div>

            <p className="text-sm leading-relaxed" style={{ color: "var(--t-text-primary)" }}>
              You are about to transfer ownership of this team vault to{" "}
              <span className="font-semibold" style={{ color: "var(--t-text-bright)" }}>{transferOwnerTarget.email}</span>.
              {" "}You will lose your owner privileges immediately and cannot undo this yourself.
            </p>

            {transferError && (
              <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", color: "var(--t-status-error)", border: "1px solid rgba(239,68,68,0.2)" }}>
                {transferError}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setTransferOwnerTarget(null); setTransferError(""); }}
                disabled={transferring}
                className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
                style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-primary)", border: "1px solid var(--t-border)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleTransferOwnership()}
                disabled={transferring}
                className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
                style={{ background: transferring ? "rgba(239,68,68,0.5)" : "#dc2626", color: "#fff", opacity: transferring ? 0.7 : 1 }}
              >
                {transferring && <Icon icon="lucide:loader-2" width={13} className="animate-spin" />}
                Transfer Ownership
              </button>
            </div>
          </div>
        </div>
      )}
    <SidePanelLayout
      panelOpen={panelOpen}
      panelWidth={320}
      panel={
        showDetailPanel && detailMember
          ? (
            <MemberDetailPanel
              member={detailMember}
              isMe={detailMember.user_id === myUserId}
              teamId={teamId}
              teamRoles={teamRoles}
              canManageMembers={canManageMembers}
              isTargetOwner={isOwnerMember(detailMember)}
              onClose={() => setShowDetailPanel(false)}
              onUpdated={reload}
            />
          )
          : showInvitePanel
            ? (
              <InvitePanel
                teamId={teamId}
                existingIds={existingMemberIds}
                teamRoles={teamRoles}
                onClose={() => setShowInvitePanel(false)}
                onMemberAdded={reload}
              />
            )
            : showRolesPanel && myUserId
              ? (
                <PanelShell>
                  <PanelHeader
                    title="Roles"
                    icon="lucide:shield"
                    onClose={() => setShowRolesPanel(false)}
                    actions={
                      <PanelHeaderIconButton
                        icon="lucide:external-link"
                        title="Open in Settings › Vaults"
                        onClick={() => openSettings("vaults")}
                      />
                    }
                  />
                  <div className="flex-1 overflow-y-auto p-4">
                    <TeamRolesPanel teamId={teamId} myUserId={myUserId} />
                  </div>
                </PanelShell>
              )
              : null
      }
      className="bg-[var(--t-bg-base)]"
    >
      <div className="flex flex-col h-full">
        <MembersToolbar
          search={search}
          onSearchChange={setSearch}
          layoutMode={layoutMode}
          onLayoutModeChange={setLayoutMode}
          sortMode={sortMode}
          onSortModeChange={setSortMode}
          canInvite={canInvite}
          showInvitePanel={showInvitePanel}
          onToggleInvite={() => { setShowInvitePanel((p) => !p); setShowDetailPanel(false); setShowRolesPanel(false); }}
          pendingCount={pendingInvites.length || undefined}
          canManageRoles={canManageRoles}
          showRolesPanel={showRolesPanel}
          onToggleRoles={() => { setShowRolesPanel((p) => !p); setShowDetailPanel(false); setShowInvitePanel(false); }}
          selectedCount={selectedIdSet.size}
          vaultTabs={vaultTabs}
          primaryVaultId={primaryVaultId}
          onSelectVault={setPrimaryVaultId}
        />

        <DragSelectSurface
          selectionAreaRef={selectionAreaRef}
          onMouseDown={handleSelectionAreaMouseDown}
          dragBox={dragBox}
          onClick={() => { setShowDetailPanel(false); setShowInvitePanel(false); }}
          className="flex-1 overflow-y-auto px-9 pt-5 pb-9"
        >
          <div ref={itemAreaRef} className="space-y-6">

            {/* Role filter bar */}
            {teamRoles.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {[...teamRoles].sort((a, b) => a.position - b.position).map((r) => {
                  const active = roleFilter.includes(r.id);
                  const meta = ROLE_META[r.name];
                  const color = r.color ?? meta?.color ?? avatarColor(r.name);
                  const bg = meta?.bg ?? `${color}1a`;
                  return (
                    <button
                      key={r.id}
                      onClick={() => setRoleFilter((prev) => prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id])}
                      className="text-[10px] px-2 py-0.5 rounded-full font-medium transition-all"
                      style={{
                        background: active ? bg : "var(--t-bg-elevated)",
                        color: active ? color : "var(--t-text-dim)",
                        border: `1px solid ${active ? `${color}44` : "var(--t-border)"}`,
                      }}
                    >
                      {r.name}
                    </button>
                  );
                })}
                {roleFilter.length > 0 && (
                  <button
                    onClick={() => setRoleFilter([])}
                    className="text-[10px] px-2 py-0.5 rounded-full transition-colors"
                    style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {/* Members section */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">
                  Members
                </p>
                <span className="text-xs text-[var(--t-text-dim)]">
                  {members.length} member{members.length !== 1 ? "s" : ""}
                  {myMember && (
                    <> · <RoleBadges member={myMember} roles={teamRoles} /></>
                  )}
                </span>
              </div>

              {sortedMembers.length === 0 && members.length === 0 && (
                <p className="text-xs py-3 text-[var(--t-text-dim)]">Loading members…</p>
              )}
              {sortedMembers.length === 0 && members.length > 0 && searchLower && (
                <p className="text-xs py-3 text-[var(--t-text-dim)]">No members match "{search}"</p>
              )}

              <div
                className={layoutMode === "grid" ? "grid gap-3" : "flex flex-col gap-1.5"}
                style={layoutMode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" } : undefined}
              >
                {sortedMembers.map((m) => (
                  <MemberCard
                    key={m.user_id}
                    member={m}
                    roles={teamRoles}
                    isMe={m.user_id === myUserId}
                    isOwner={isOwnerMember(m)}
                    isSelected={selectedIdSet.has(m.user_id)}
                    isFocused={focusedId === m.user_id}
                    layoutMode={layoutMode}
                    canManage={canManageMembers && !isOwnerMember(m) && m.user_id !== myUserId}
                    onAddRole={() => { setDetailMemberId(m.user_id); setShowDetailPanel(true); setShowInvitePanel(false); }}
                    onSelect={(id, e) => { e.stopPropagation(); handleItemSelect(id, e); }}
                    onDoubleClick={() => { setDetailMemberId(m.user_id); setShowDetailPanel(true); setShowInvitePanel(false); }}
                    contextMenuItems={buildContextMenuItems(m)}
                    bulkContextMenuItems={selectedIdSet.has(m.user_id) ? bulkContextMenuItems : undefined}
                  />
                ))}
              </div>
            </div>

            {/* Pending invitations */}
            {pendingInvites.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
                  Pending Invitations
                </p>
                <div className="flex flex-col gap-1.5">
                  {pendingInvites.map((inv) => (
                    <PendingInviteCard
                      key={inv.id}
                      inv={inv}
                      teamId={teamId}
                      roles={teamRoles}
                      onRevoked={() => { if (teamId) loadPendingInvitations(teamId).catch(() => {}); }}
                    />
                  ))}
                </div>
              </div>
            )}

          </div>
        </DragSelectSurface>
      </div>
    </SidePanelLayout>
    </>
  );
}
