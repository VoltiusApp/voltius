import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cardGridProps } from "@/components/shared/cardGrid";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { selectFollowing } from "@/utils/cardInteraction";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import type { TeamMember } from "@/stores/teamStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useUIStore, type MembersPanel } from "@/stores/uiStore";
import { isMobileShell } from "@/utils/platform";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { avatarColor } from "@/components/shared/AvatarStack";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { SidePanelLayout } from "@/components/shared/SidePanelLayout";
import { DragSelectSurface } from "@/components/shared/DragSelectSurface";
import { PanelShell, PanelHeader } from "@/components/shared/Panel";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import { useLackReason } from "@/hooks/useGreyedUnless";
import { refuseWhilePreviewing, whenWritable } from "@/services/previewGuard";
import { runTeamAction } from "@/services/teamActionFeedback";
import { TeamRolesPanel } from "@/components/members/panels/RolesPanel";
import { SecurityPolicyPanel } from "@/components/members/panels/SecurityPolicyPanel";
import { guestCapFor, inviteSessionOf, memberHasAccess, seatUsage, sessionDisplayName } from "@/services/teamSharing";
import { RoleToggleChip, roleLabel } from "@/components/members/roleChips";
import { ConvertToTeamGate } from "@/components/vault-share/ConvertToTeamGate";
import { OffboardingDialog } from "@/components/members/OffboardingDialog";
import { PendingInviteCard } from "@/components/members/cards/PendingInviteCard";
import { JoinRequestsSection } from "@/components/members/cards/JoinRequests";
import { MembersToolbar } from "@/components/members/MembersToolbar";
import { RoleBadges } from "@/components/members/roleBadges";
import { MemberCard, memberOpenAction } from "@/components/members/cards/MemberCard";
import { PrivateVaultMembers, privateVaultGate, useMyHandle } from "@/components/members/cards/PrivateVaultMembers";
import { MembersEmptyState } from "@/components/members/cards/MembersEmptyState";
import { MemberDetailPanel } from "@/components/members/panels/MemberDetailPanel";
import { InvitePanel } from "@/components/members/panels/InvitePanel";
import { memberLabel, memberNamingSupported } from "@/services/memberLabel";
import { useMembersModel } from "@/components/members/useMembersModel";
import { useViewAsGate } from "@/components/preview/useViewAsEntry";

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MembersPage() {
  const { t } = useTranslation();
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const { teams, loadPendingInvitations } = useTeamStore();
  const { tier, ownsTeamsPlan, accountMode } = useSubscriptionStore();
  const { activeSessions, connections } = useTeamSessionStore();

  const layoutMode = useUIStore((s) => s.membersLayoutMode);
  const sortMode = useUIStore((s) => s.membersSortMode);
  const setLayoutMode = useUIStore((s) => s.setMembersLayoutMode);
  const setSortMode = useUIStore((s) => s.setMembersSortMode);
  const membersPanelPending = useUIStore((s) => s.membersPanelPending);
  const clearMembersPanelPending = useUIStore((s) => s.clearMembersPanelPending);

  const noPermission = useLackReason();
  const myHandle = useMyHandle();
  const [primaryVaultId, setPrimaryVaultId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [panel, setPanel] = useState<MembersPanel | "detail" | null>(null);
  const togglePanel = (next: MembersPanel) => {
    if (next === "invite" && refuseWhilePreviewing()) return;
    setPanel((cur) => (cur === next ? null : next));
  };
  const closeTransientPanel = () => setPanel((cur) => (cur === "detail" || cur === "invite" ? null : cur));
  const [offboardingMembers, setOffboardingMembers] = useState<TeamMember[] | null>(null);

  useEffect(() => {
    if (!membersPanelPending) return;
    setPanel(membersPanelPending);
    clearMembersPanelPending();
  }, [membersPanelPending, clearMembersPanelPending]);
  const [detailMemberId, setDetailMemberId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedVaultIds.length > 0) {
      setPrimaryVaultId((prev) =>
        selectedVaultIds.includes(prev ?? "") ? prev : selectedVaultIds[0]
      );
    } else {
      setPrimaryVaultId(null);
    }
  }, [selectedVaultIds]);

  const model = useMembersModel(primaryVaultId);
  const {
    teamId, localVault, members, roles: teamRoles, pending: pendingInvites, myUserId, myMember,
    canManageMembers, canManageRoles, canInvite, canManageVault, canNameMembers,
    isOwnerMember, canActOn, canEditMember, outOfReach, reload,
  } = model;
  const viewAsGate = useViewAsGate(teamId ?? "");

  const existingMemberIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);

  const searchLower = search.trim();
  const sortedMembers = useMemo(() => model.visible(search, roleFilter, sortMode),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [members, teamRoles, search, roleFilter, sortMode]);

  const orderedIds = useMemo(() => sortedMembers.map((m) => m.user_id), [sortedMembers]);

  const {
    selectedIdSet, selectionAreaRef, itemAreaRef, dragBox,
    handleItemSelect, handleSelectionAreaMouseDown,
    selectSingle, setSelection,
  } = useDragSelection(orderedIds);

  const detailMember = detailMemberId ? members.find((m) => m.user_id === detailMemberId) ?? null : null;
  const openDetail = (id: string) => { setDetailMemberId(id); setPanel("detail"); };

  const { focusedId } = useListKeyNav({
    orderedIds,
    selectedIdSet,
    selectSingle,
    setSelection,
    itemAreaRef,
    layoutMode,
    onEnter: openDetail,
    onEdit: openDetail,
    onEscape: closeTransientPanel,
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

  const askOffboarding = whenWritable(setOffboardingMembers);

  // Context menu builders
  const buildContextMenuItems = (member: TeamMember): ContextMenuItem[] => {
    const canActOnMember = canActOn(member);
    const items: ContextMenuItem[] = [{
      ...memberOpenAction(t, canEditMember(member)),
      shortcut: "E",
      onClick: () => openDetail(member.user_id),
    }];

    if (!canManageMembers) {
      items.push({ label: t("members.roles"), icon: "lucide:shield", disabledReason: noPermission, onClick: () => {} });
    } else if (canActOnMember && teamRoles.length > 0) {
      const assignedRoles = model.roleOptions([member], "remove").filter((r) => member.role_ids.includes(r.id));
      const unassignedRoles = model.roleOptions([member], "assign").filter((r) => !member.role_ids.includes(r.id));

      const assignedItems: ContextMenuItem[] = assignedRoles.map((r) => ({
        label: roleLabel(t, r.name),
        icon: "lucide:square-check-big",
        onClick: () => void model.changeRole([member], r, "remove"),
      }));

      const unassignedItems: ContextMenuItem[] = unassignedRoles.map((r, i) => ({
        label: roleLabel(t, r.name),
        icon: "lucide:square",
        divider: i === 0 && assignedItems.length > 0,
        onClick: () => void model.changeRole([member], r, "assign"),
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
              onClick: whenWritable(() => {
                void runTeamAction({
                  pending: t("members.toast.invitingToSession", { name: memberLabel(member) }),
                  success: t("members.toast.invitedToSession", { name: memberLabel(member) }),
                  run: () => useTeamSessionStore.getState().inviteToActiveSession(localSessionId, { ...member, handle: member.handle ?? "" }),
                }).catch(() => { /* toast already reports the failure */ });
              }),
            }))
          : [{
              label: t(hostedSessions.length > 0 ? "members.contextMenu.noInvitableSessions" : "members.contextMenu.noActiveSessions"),
              onClick: () => {},
            }],
      });
    }

    if (canActOnMember || !canManageMembers) {
      items.push({
        label: t("members.kick"),
        icon: "lucide:user-minus",
        danger: true,
        divider: true,
        disabledReason: canManageMembers ? undefined : noPermission,
        onClick: () => askOffboarding([member]),
      });
    }

    if (!isMobileShell()) {
      const viewAs = viewAsGate({ type: "member", user_id: member.user_id });
      const afterRoles = Math.max(items.findIndex((i) => i.label === t("members.roles")), 0) + 1;
      items.splice(afterRoles, 0, {
        label: t("members.viewAs.menuItem", { name: memberLabel(member) }),
        icon: "lucide:scan-eye",
        disabledReason: viewAs.reasonText ?? undefined,
        onClick: viewAs.enter,
      });
    }

    if (items.length > 1) items[1] = { ...items[1], divider: true };
    return items;
  };

  const bulkContextMenuItems = useMemo((): ContextMenuItem[] | undefined => {
    if (selectedIdSet.size <= 1) return undefined;
    const selectedMembers = sortedMembers.filter((m) =>
      selectedIdSet.has(m.user_id) && m.user_id !== myUserId && !outOfReach(m)
    );
    if (selectedMembers.length === 0) return undefined;

    const items: ContextMenuItem[] = [];

    if (!canManageMembers) {
      for (const [label, icon] of [["assignRoleBulk", "lucide:shield"], ["removeRoleBulk", "lucide:shield-off"]]) {
        items.push({ label: t(`members.contextMenu.${label}`, { count: selectedMembers.length }), icon, disabledReason: noPermission, onClick: () => {} });
      }
    } else if (teamRoles.length > 0) {
      for (const [mode, icon] of [["assign", "lucide:shield"], ["remove", "lucide:shield-off"]] as const) {
        items.push({
          label: t(`members.contextMenu.${mode}RoleBulk`, { count: selectedMembers.length }),
          icon,
          children: model.roleOptions(selectedMembers, mode).map((r) => ({
            label: roleLabel(t, r.name),
            onClick: () => void model.changeRole(selectedMembers, r, mode, { bulk: true }),
          })),
        });
      }
    }

    items.push({
      label: t("members.contextMenu.kickBulk", { count: selectedMembers.length }),
      icon: "lucide:user-minus",
      danger: true,
      divider: items.length > 0,
      disabledReason: canManageMembers ? undefined : noPermission,
      onClick: () => askOffboarding(selectedMembers),
    });

    return items.length > 0 ? items : undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdSet, sortedMembers, myUserId, canManageMembers, noPermission, teamRoles, teamId, t, outOfReach, model.roleOptions, model.changeRole]);

const vaultTabs = selectedVaultIds.length > 1
    ? selectedVaultIds.map((vid) => {
        const v = vaults.find((x) => x.id === vid) ?? teams.find((t) => t.id === vid);
        return { id: vid, name: v ? v.name : vid };
      })
    : undefined;

  if (!primaryVaultId) return <MembersEmptyState kind="noVault" />;

  // ── Private vault (no team yet) ────────────────────────────────────────────
  if (localVault && !teamId) {
    const privateReady = privateVaultGate({ accountMode, ownsTeamsPlan, myUserId }) === "ready";
    return (
      <>
        {panel === "invite" && privateReady && (
          <ConvertToTeamGate
            vaultId={primaryVaultId}
            vaultName={localVault.name}
            onCancel={() => setPanel(null)}
            onConverted={() => {}}
          />
        )}
        <PrivateVaultMembers
          handle={myHandle}
          myUserId={myUserId}
          layoutMode={layoutMode}
          header={
            <MembersToolbar
              search={search}
              onSearchChange={setSearch}
              layoutMode={layoutMode}
              onLayoutModeChange={setLayoutMode}
              sortMode={sortMode}
              onSortModeChange={setSortMode}
              canInvite={privateReady}
              activePanel={panel}
              onTogglePanel={togglePanel}
              selectedCount={0}
              vaultTabs={vaultTabs}
              primaryVaultId={primaryVaultId}
              onSelectVault={setPrimaryVaultId}
            />
          }
        />
      </>
    );
  }

  if (!teamId) return <MembersEmptyState kind="vaultNotFound" />;

  // ── Team vault ─────────────────────────────────────────────────────────────
  // Hidden, not cleared: a deep link opens it before this team's members (and so our permissions) load.
  const shownPanel = panel === "security" && !canManageVault ? null : panel;
  const panelOpen = shownPanel !== null;
  const toolbarPanel = (title: string, icon: string, body: ReactNode) => (
    <PanelShell>
      <PanelHeader title={title} icon={icon} onClose={() => setPanel(null)} />
      <div className="flex-1 overflow-y-auto p-4">{body}</div>
    </PanelShell>
  );

  return (
    <>
    <SidePanelLayout
      panelOpen={panelOpen}
      panelWidth={320}
      panel={
        shownPanel === "detail" && detailMember
          ? (
            <MemberDetailPanel
              key={detailMember.user_id}
              member={detailMember}
              isMe={detailMember.user_id === myUserId}
              teamId={teamId}
              teamRoles={teamRoles}
              canManageMembers={canManageMembers}
              canNameMembers={canNameMembers}
              namingSupported={memberNamingSupported(members)}
              isTargetOwner={isOwnerMember(detailMember)}
              viewer={myMember}
              onClose={() => setPanel(null)}
              onUpdated={reload}
            />
          )
          : shownPanel === "invite"
            ? (
              <InvitePanel
                teamId={teamId}
                existingIds={existingMemberIds}
                teamRoles={teamRoles}
                canNameMembers={canNameMembers}
                onClose={() => setPanel(null)}
                onMemberAdded={reload}
              />
            )
            : shownPanel === "roles"
              ? toolbarPanel(t("members.roles"), "lucide:shield", <TeamRolesPanel teamId={teamId} />)
              : shownPanel === "security"
                ? toolbarPanel(t("members.security.title"), "lucide:shield-check", <SecurityPolicyPanel teamId={teamId} />)
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
          activePanel={shownPanel}
          onTogglePanel={togglePanel}
          pendingCount={pendingInvites.length || undefined}
          canManageRoles={canManageRoles}
          canManageVault={canManageVault}
          selectedCount={selectedIdSet.size}
          vaultTabs={vaultTabs}
          primaryVaultId={primaryVaultId}
          onSelectVault={setPrimaryVaultId}
        />

        <DragSelectSurface
          selectionAreaRef={selectionAreaRef}
          onMouseDown={handleSelectionAreaMouseDown}
          dragBox={dragBox}
          onClick={closeTransientPanel}
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
              <SectionHeader
                label={t("members.heading.members")}
                count={sortedMembers.length}
                aside={myMember && <RoleBadges member={myMember} roles={teamRoles} />}
              />

              {sortedMembers.length === 0 && members.length === 0 && (
                <p className="text-xs py-3 text-(--t-text-dim)">{t("members.loading")}</p>
              )}
              {sortedMembers.length === 0 && members.length > 0 && searchLower && (
                <p className="text-xs py-3 text-(--t-text-dim)">{t("members.noMatch", { search })}</p>
              )}

              <div
                {...cardGridProps(layoutMode, "compact")}
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
                    isEditing={panel === "detail" && detailMemberId === m.user_id}
                    layoutMode={layoutMode}
                    canManage={canActOn(m)}
                    editable={canEditMember(m)}
                    onAddRole={() => openDetail(m.user_id)}
                    onSelect={selectFollowing(handleItemSelect, panel === "detail", () => setDetailMemberId(m.user_id))}
                    onOpen={() => openDetail(m.user_id)}
                    contextMenuItems={buildContextMenuItems(m)}
                    bulkContextMenuItems={selectedIdSet.has(m.user_id) ? bulkContextMenuItems : undefined}
                  />
                ))}
              </div>
            </div>

            {/* Pending invitations */}
            {pendingInvites.length > 0 && (
              <div>
                <SectionHeader label={t("members.heading.pendingInvitations")} count={pendingInvites.length} />
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

            {canInvite && teamId && <JoinRequestsSection teamId={teamId} />}
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
