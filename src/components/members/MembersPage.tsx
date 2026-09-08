import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import type { TeamMember } from "@/stores/teamStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useUIStore } from "@/stores/uiStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { useHistoryStore } from "@/stores/historyStore";
import { avatarColor } from "@/components/shared/AvatarStack";
import { getMyUserId } from "@/services/teamService";
import { getMyHandle } from "@/services/account";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { SidePanelLayout } from "@/components/shared/SidePanelLayout";
import { DragSelectSurface } from "@/components/shared/DragSelectSurface";
import { PanelShell, PanelHeader, PanelHeaderIconButton } from "@/components/shared/Panel";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import { effectivePermissions, hasBuiltinRole, PERM_BITS } from "@/hooks/usePermission";
import { runTeamAction } from "@/services/teamActionFeedback";
import { TeamRolesPanel } from "@/components/settings/sections/RolesSection";
import { guestCapFor, inviteSessionOf, memberHasAccess, seatUsage, sessionDisplayName } from "@/services/teamSharing";
import { RoleToggleChip } from "@/components/members/roleChips";
import { ConvertToTeamGate } from "@/components/vault-share/ConvertToTeamGate";
import { OffboardingDialog } from "@/components/members/OffboardingDialog";
import { PendingInviteCard } from "@/components/members/cards/PendingInviteCard";
import { MembersToolbar } from "@/components/members/MembersToolbar";
import { RoleBadges } from "@/components/members/roleBadges";
import { MemberCard } from "@/components/members/cards/MemberCard";
import { SelfCard } from "@/components/members/cards/SelfCard";
import { MemberDetailPanel } from "@/components/members/panels/MemberDetailPanel";
import { InvitePanel } from "@/components/members/panels/InvitePanel";
import { SignInToCloudCTA, UpgradeToTeamsCTA } from "@/components/members/panels/MembersCTA";

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MembersPage() {
  const { t } = useTranslation();
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const { teams, loadTeams, membersByTeam, loadMembers, rolesByTeam, loadRoles, pendingInvitationsByTeam, loadPendingInvitations } = useTeamStore();
  const { tier, isTeams, accountMode } = useSubscriptionStore();
  const assignMemberRole = useTeamStore((s) => s.assignMemberRole);
  const removeMemberRole = useTeamStore((s) => s.removeMemberRole);
  const push = useHistoryStore((s) => s.push);
  const { activeSessions, connections } = useTeamSessionStore();

  const layoutMode = useUIStore((s) => s.membersLayoutMode);
  const sortMode = useUIStore((s) => s.membersSortMode);
  const setLayoutMode = useUIStore((s) => s.setMembersLayoutMode);
  const setSortMode = useUIStore((s) => s.setMembersSortMode);
  const membersInvitePending = useUIStore((s) => s.membersInvitePending);
  const clearMembersInvitePending = useUIStore((s) => s.clearMembersInvitePending);
  const openSettings = useUIStore((s) => s.openSettings);
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);

  const [myUserId, setMyUserId] = useState("");
  const [myHandle, setMyHandle] = useState<string | null>(null);
  const [primaryVaultId, setPrimaryVaultId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showRolesPanel, setShowRolesPanel] = useState(false);
  const [offboardingMembers, setOffboardingMembers] = useState<TeamMember[] | null>(null);

  useEffect(() => {
    if (membersInvitePending) {
      setShowInvitePanel(true);
      setShowDetailPanel(false);
      clearMembersInvitePending();
    }
  }, [membersInvitePending, clearMembersInvitePending]);
  const [detailMemberId, setDetailMemberId] = useState<string | null>(null);

  useEffect(() => {
    getMyUserId().then((id) => { if (id) setMyUserId(id); }).catch(() => {});
    // getMyHandle() resolves to "" (never rejects) on a keychain miss with no
    // server to fall back to, so this always settles the loading skeleton.
    getMyHandle().then(setMyHandle).catch(() => setMyHandle(""));
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

  // Filter + sort
  const searchLower = search.trim().toLowerCase();
  const filteredMembers = useMemo(() => {
    let result = members;
    if (searchLower) result = result.filter((m) => (m.handle ?? "").toLowerCase().includes(searchLower));
    if (roleFilter.length > 0) result = result.filter((m) => roleFilter.some((rid) => m.role_ids.includes(rid)));
    return result;
  }, [members, searchLower, roleFilter]);

  const sortedMembers = useMemo(() => {
    return [...filteredMembers].sort((a, b) => {
      switch (sortMode) {
        case "name-asc":  return (a.handle ?? "").localeCompare(b.handle ?? "");
        case "name-desc": return (b.handle ?? "").localeCompare(a.handle ?? "");
        case "newest":    return b.joined_at.localeCompare(a.joined_at);
        case "oldest":    return a.joined_at.localeCompare(b.joined_at);
        case "role-asc": {
          const posA = Math.min(...(a.role_ids.map((rid) => teamRoles.find((r) => r.id === rid)?.position ?? 9999)));
          const posB = Math.min(...(b.role_ids.map((rid) => teamRoles.find((r) => r.id === rid)?.position ?? 9999)));
          if (posA !== posB) return posA - posB;
          return (a.handle ?? "").localeCompare(b.handle ?? "");
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

  // Sessions this client hosts with the session key still in memory — the only
  // ones `inviteToActiveSession` can actually invite someone into (#66 follow-up).
  // `connections` carries no display name, so join against `activeSessions` for it.
  // Each carries the same seat/cap derivation the ShareMenu roster uses, so this
  // surface cannot hand out invites the shared session has no room for.
  const hostedSessions = useMemo(() => Object.entries(connections)
    .filter(([, c]) => c.role === "host" && c.sessionKeyBytes)
    .flatMap(([localSessionId, c]) => {
      const active = activeSessions.find((s) => s.id === c.multiplayerSessionId);
      if (!active) return [];
      const session = inviteSessionOf(c, active);
      const { atCap } = seatUsage(session, [], guestCapFor(c.vaultOwnerTier ?? tier));
      return [{ localSessionId, connectionName: sessionDisplayName(active), session, atCap }];
    }), [connections, activeSessions, tier]);

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
        icon: "lucide:square-check-big",
        onClick: () => {
          void removeMemberRole(teamId!, member.user_id, r.id).then(() => {
            push({
              label: t("members.history.removeRole", { name: member.handle }),
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
              label: t("members.history.assignRole", { name: member.handle }),
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
          label: t("members.roles"),
          icon: "lucide:shield",
          children: roleChildren,
        });
      }
    }


    if (member.user_id !== myUserId) {
      // Sessions with a seat left that this member has no route into already.
      const invitable = hostedSessions.filter(
        (s) => !s.atCap && !memberHasAccess({ user_id: member.user_id, teamIds: [member.team_id] }, s.session),
      );
      items.push({
        label: t("members.contextMenu.inviteToSession"),
        icon: "lucide:terminal",
        children: invitable.length > 0
          ? invitable.map(({ localSessionId, connectionName }) => ({
              label: connectionName,
              onClick: () => {
                void runTeamAction({
                  pending: t("members.toast.invitingToSession", { name: member.handle }),
                  success: t("members.toast.invitedToSession", { name: member.handle }),
                  run: () => useTeamSessionStore.getState().inviteToActiveSession(localSessionId, { ...member, handle: member.handle ?? "" }),
                }).catch(() => { /* toast already reports the failure */ });
              },
            }))
          : [{
              label: t(hostedSessions.length > 0 ? "members.contextMenu.noInvitableSessions" : "members.contextMenu.noActiveSessions"),
              onClick: () => {},
            }],
      });
    }

    if (canActOnMember) {
      items.push({
        label: t("members.kick"),
        icon: "lucide:user-minus",
        danger: true,
        divider: true,
        onClick: () => setOffboardingMembers([member]),
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
        label: t("members.contextMenu.assignRoleBulk", { count: selectedMembers.length }),
        icon: "lucide:shield",
        children: sortedBulkRoles.map((r) => ({
          label: r.name,
          onClick: () => {
            const prevRoleIds = selectedMembers.map((m) => ({ userId: m.user_id, roleIds: [...m.role_ids] }));
            void Promise.all(selectedMembers.map((m) => assignMemberRole(teamId!, m.user_id, r.id))).then(() => {
              push({
                label: t("members.history.assignRoleBulk", { count: selectedMembers.length }),
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
        label: t("members.contextMenu.removeRoleBulk", { count: selectedMembers.length }),
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
                label: t("members.history.removeRoleBulk", { count: selectedMembers.length }),
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
        label: t("members.contextMenu.kickBulk", { count: selectedMembers.length }),
        icon: "lucide:user-minus",
        danger: true,
        divider: items.length > 0,
        onClick: () => setOffboardingMembers(selectedMembers),
      });
    }

    return items.length > 0 ? items : undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdSet, sortedMembers, myUserId, canManageMembers, teamRoles, teamId, t]);

const vaultTabs = selectedVaultIds.length > 1
    ? selectedVaultIds.map((vid) => {
        const v = vaults.find((x) => x.id === vid) ?? teams.find((t) => t.id === vid);
        return { id: vid, name: v ? v.name : vid };
      })
    : undefined;

  // ── No vault selected ──────────────────────────────────────────────────────
  if (!primaryVaultId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-(--t-bg-base)">
        <div
          className="flex items-center justify-center rounded-3xl w-[5.333rem] h-[5.333rem] text-(--t-text-dim)"
          style={{
            background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)",
            border: "1px solid var(--t-border)",
          }}
        >
          <Icon icon="lucide:users-round" width={36} />
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <span className="text-base font-semibold text-(--t-text-primary)">{t("members.empty.noVaultTitle")}</span>
          <span className="text-sm text-(--t-text-dim) max-w-[18.667rem]">
            {t("members.empty.noVaultDesc")}
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
        <div className="flex-1 flex flex-col bg-(--t-bg-base)">
          {toolbar}
          <SignInToCloudCTA onSignIn={() => openCloudAuth("signin")} />
        </div>
      );
    }

    if (!isTeams) {
      return (
        <div className="flex-1 flex flex-col bg-(--t-bg-base)">
          {toolbar}
          <UpgradeToTeamsCTA />
        </div>
      );
    }
    if (!myUserId) {
      return (
        <div className="flex-1 flex flex-col bg-(--t-bg-base)">
          {toolbar}
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <Icon icon="lucide:users-round" width={28} style={{ color: "var(--t-text-dim)" }} />
            <p className="text-sm text-(--t-text-dim)">{t("members.empty.signInToInvite")}</p>
          </div>
        </div>
      );
    }

    return (
      <>
        {showInvitePanel && (
          <ConvertToTeamGate
            vaultId={primaryVaultId}
            vaultName={localVault.name}
            onCancel={() => setShowInvitePanel(false)}
            onConverted={() => {}}
          />
        )}
        <div className="flex-1 flex flex-col chrome-canvas">
          {toolbar}
          <div className="flex-1 overflow-y-auto px-9 pt-5 pb-9">
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">{t("members.heading.members")}</p>
            <div
              className={layoutMode === "grid" ? "grid gap-4" : "flex flex-col gap-1"}
              style={layoutMode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" } : undefined}
            >
              <SelfCard handle={myHandle} layoutMode={layoutMode} />
            </div>
          </div>
        </div>
        </div>
      </>
    );
  }

  // ── Vault not found ────────────────────────────────────────────────────────
  if (!teamId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center bg-(--t-bg-base)">
        <Icon icon="lucide:vault" width={28} style={{ color: "var(--t-text-dim)" }} />
        <p className="text-sm text-(--t-text-dim)">{t("members.empty.vaultNotFound")}</p>
      </div>
    );
  }

  // ── Team vault ─────────────────────────────────────────────────────────────
  const panelOpen = showDetailPanel || showInvitePanel || showRolesPanel;

  return (
    <>
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
                    title={t("members.roles")}
                    icon="lucide:shield"
                    onClose={() => setShowRolesPanel(false)}
                    actions={
                      <PanelHeaderIconButton
                        icon="lucide:external-link"
                        title={t("members.openInSettingsVaults")}
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
      className="bg-(--t-bg-base)"
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
                {[...teamRoles].sort((a, b) => a.position - b.position).map((r) => (
                  <RoleToggleChip
                    key={r.id}
                    variant="pill"
                    name={r.name}
                    color={r.color}
                    fallbackColor={avatarColor(r.name)}
                    active={roleFilter.includes(r.id)}
                    onClick={() => setRoleFilter((prev) => prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id])}
                  />
                ))}
                {roleFilter.length > 0 && (
                  <button
                    onClick={() => setRoleFilter([])}
                    className="text-[10px] px-2 py-0.5 rounded-full transition-colors"
                    style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}
                  >
                    {t("members.toolbar.clear")}
                  </button>
                )}
              </div>
            )}

            {/* Members section */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
                  {t("members.heading.members")}
                </p>
                <span className="text-xs text-(--t-text-dim)">
                  {t("members.count", { count: members.length })}
                  {myMember && (
                    <> · <RoleBadges member={myMember} roles={teamRoles} /></>
                  )}
                </span>
              </div>

              {sortedMembers.length === 0 && members.length === 0 && (
                <p className="text-xs py-3 text-(--t-text-dim)">{t("members.loading")}</p>
              )}
              {sortedMembers.length === 0 && members.length > 0 && searchLower && (
                <p className="text-xs py-3 text-(--t-text-dim)">{t("members.noMatch", { search })}</p>
              )}

              <div
                className={layoutMode === "grid" ? "grid gap-4" : "flex flex-col gap-1"}
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
                <p className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
                  {t("members.heading.pendingInvitations")}
                </p>
                <div className="flex flex-col gap-1.5">
                  {pendingInvites.map((inv) => (
                    <PendingInviteCard
                      key={inv.id}
                      inv={inv}
                      teamId={teamId}
                      roles={teamRoles}
                      onRevoked={() => { if (teamId) loadPendingInvitations(teamId).catch(() => {}); }}
                      onResent={() => { if (teamId) loadPendingInvitations(teamId).catch(() => {}); }}
                    />
                  ))}
                </div>
              </div>
            )}

          </div>
        </DragSelectSurface>
      </div>
    </SidePanelLayout>

    {offboardingMembers && (
      <OffboardingDialog
        members={offboardingMembers}
        teamId={teamId}
        mode="remove"
        onClose={() => setOffboardingMembers(null)}
        onDone={reload}
      />
    )}
    </>
  );
}
