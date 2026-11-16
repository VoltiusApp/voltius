import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TeamMember, TeamRole } from "@/stores/teamStore";
import type { PendingInvitation } from "@/services/teamService";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useUIStore } from "@/stores/uiStore";
import { useBackInterceptor } from "@/hooks/useBackInterceptor";
import { useGreyedUnless, useLackReason } from "@/hooks/useGreyedUnless";
import { whenWritable } from "@/services/previewGuard";
import { searchMatcher } from "@/utils/search";
import { ROLE_MODE_ICONS, useMembersModel, type RoleChangeMode } from "@/components/members/useMembersModel";
import { OffboardingDialog } from "@/components/members/OffboardingDialog";
import { JoinRequestsSection } from "@/components/members/cards/JoinRequests";
import { MembersEmptyState } from "@/components/members/cards/MembersEmptyState";
import { PrivateVaultMembers, useMyHandle } from "@/components/members/cards/PrivateVaultMembers";
import { VAULT_ACTION_ICONS } from "@/components/vault-admin/vaultMenuItems";
import MobilePanelHeader from "../panels/MobilePanelHeader";
import MobileFilterBar from "../MobileFilterBar";
import MobileFab from "../MobileFab";
import MobileSectionHeading from "../MobileSectionHeading";
import MobileSelectionBar, { type BarAction } from "../MobileSelectionBar";
import { NO_LARGE_TITLE, useCollapsingHeader } from "../useCollapsingHeader";
import { allKeysSelected, pruneKeys, toggleAllKeys, toggleKey } from "../selectionCore";
import RolePickerSheet from "../sheets/RolePickerSheet";
import PendingInviteActionsSheet from "../sheets/PendingInviteActionsSheet";
import { InviteRow, MemberRow, NavRow } from "./members/MembersRows";

const byId = (id: string) => id;

export default function MobileMembersScreen({ vaultId }: { vaultId: string | null }) {
  const { t } = useTranslation();
  const model = useMembersModel(vaultId);
  const { teamId, localVault, members, roles, pending, myUserId, canActOn, canManageMembers, canInvite, canManageVault } = model;
  const myHandle = useMyHandle();
  const push = useMobileNavStore((s) => s.push);
  const sortMode = useUIStore((s) => s.membersSortMode);
  const lackReason = useLackReason();
  const greyed = useGreyedUnless();
  const rootRef = useRef<HTMLDivElement>(null);
  const { onScroll, fabExtended } = useCollapsingHeader(rootRef, NO_LARGE_TITLE);

  const [search, setSearch] = useState("");
  const [selIds, setSelIds] = useState<string[]>([]);
  const [picker, setPicker] = useState<RoleChangeMode | null>(null);
  const [offboarding, setOffboarding] = useState<TeamMember[] | null>(null);
  const [inviteFor, setInviteFor] = useState<PendingInvitation | null>(null);

  useEffect(() => {
    setSelIds((s) => pruneKeys(s, members.filter(canActOn).map((m) => m.user_id), byId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);
  const clear = () => setSelIds([]);
  const selecting = selIds.length > 0;
  useBackInterceptor(selecting, clear);
  useBackInterceptor(offboarding !== null, () => setOffboarding(null));
  const askOffboarding = whenWritable(setOffboarding);

  const header = <MobilePanelHeader title={t("mobile.morePages.members")} />;
  const shell = (body: ReactNode) => (
    <div ref={rootRef} className="group/appbar absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)" data-mobile-members={vaultId ?? ""}>
      {body}
    </div>
  );

  if (!vaultId) return shell(<>{header}<MembersEmptyState kind="noVault" /></>);
  if (localVault && !teamId) {
    return shell(<PrivateVaultMembers header={header} handle={myHandle} myUserId={myUserId} layoutMode="list" bodyClassName="px-4 pt-2 pb-4" />);
  }
  if (!teamId) return shell(<>{header}<MembersEmptyState kind="vaultNotFound" /></>);

  const visible = model.visible(search, [], sortMode);
  const matches = searchMatcher(search);
  const visiblePending = pending.filter((inv) => matches(inv.member_name, inv.display_name));
  const me = visible.find((m) => m.user_id === myUserId);
  const others = visible.filter((m) => m.user_id !== myUserId);
  const selectableIds = visible.filter(canActOn).map((m) => m.user_id);
  const selected = members.filter((m) => selIds.includes(m.user_id));
  const toggle = (m: TeamMember) => setSelIds((s) => toggleKey(s, m.user_id, byId));
  const selectReason = (m: TeamMember) =>
    canActOn(m) ? null
      : m.user_id === myUserId ? t("mobile.members.selectSelf")
      : !canManageMembers ? lackReason
      : t("mobile.members.selectOwner");
  const openPage = (page: "roles" | "security" | "share") => push({ kind: "vault-settings", vaultId, page });

  const blockedReason = canManageMembers ? null : lackReason;
  const actions: BarAction[] = [
    ...(["assign", "remove"] as const).map((mode) => ({
      attr: `data-members-sel-${mode}`, icon: ROLE_MODE_ICONS[mode], label: t(`mobile.members.${mode}Role`),
      disabledReason: blockedReason, onTap: () => setPicker(mode),
    })),
    { attr: "data-members-sel-kick", icon: "lucide:user-minus", label: t("members.kick"), danger: true, disabledReason: blockedReason, onTap: () => askOffboarding(selected) },
  ];

  const memberRow = (m: TeamMember) => (
    <MemberRow key={m.user_id} member={m} roles={roles}
      selecting={selecting} selected={selIds.includes(m.user_id)} selectDisabledReason={selectReason(m)}
      onTap={() => (selecting ? toggle(m) : push({ kind: "member", teamId, userId: m.user_id }))}
      onLong={() => toggle(m)} />
  );
  const security = greyed(canManageVault);
  const holders = (r: TeamRole) => selected.filter((m) => m.role_ids.includes(r.id)).length;
  const heldByAll = (r: TeamRole) => holders(r) === selected.length;
  const pickReason = (r: TeamRole) =>
    picker === "assign" ? (heldByAll(r) ? t("mobile.members.alreadyAssigned") : null)
      : holders(r) === 0 ? t("mobile.members.notAssigned") : null;

  return shell(
    <>
      {selecting ? (
        <MobileSelectionBar attr="members-selection-bar" count={selIds.length} allSelected={allKeysSelected(selIds, selectableIds, byId)}
          onClose={clear} onToggleAll={() => setSelIds((s) => toggleAllKeys(s, selectableIds, byId))} actions={actions} />
      ) : header}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-none" style={{ overscrollBehavior: "contain", paddingBottom: "var(--vt-safe-bottom)" }} onScroll={onScroll}>
        <MobileFilterBar attr="members-filter" value={search} onChange={setSearch}
          placeholder={t("members.toolbar.filterPlaceholder")} className="sticky top-0 z-[1] bg-(--t-bg-base)" />
        <NavRow id="roles" icon={VAULT_ACTION_ICONS.roles} label={t("mobile.vaultSettings.rows.roles")} onTap={() => openPage("roles")} />
        <NavRow id="security" icon={VAULT_ACTION_ICONS.security} label={t("mobile.vaultSettings.rows.security")}
          disabledReason={security.title} onTap={() => openPage("security")} />

        {me && (
          <section data-members-section="you">
            <MobileSectionHeading label={t("members.you")} />
            {memberRow(me)}
          </section>
        )}
        <section data-members-section="members">
          <MobileSectionHeading label={t("members.heading.members")} />
          {model.loading && <p className="px-4 py-3 text-sm text-(--t-text-dim)">{t("members.loading")}</p>}
          {!model.loading && others.length === 0 && search.trim() && (
            <p className="px-4 py-3 text-sm text-(--t-text-dim)">{t("members.noMatch", { search })}</p>
          )}
          {others.map(memberRow)}
        </section>
        <section data-members-section="pending">
          {visiblePending.length > 0 && <MobileSectionHeading label={t("members.heading.pendingInvitations")} />}
          {visiblePending.map((inv) => <InviteRow key={inv.id} inv={inv} onTap={() => setInviteFor(inv)} />)}
          {canInvite && <div data-vt-hit-scope className="px-4 pt-4"><JoinRequestsSection teamId={teamId} /></div>}
        </section>
        <div aria-hidden className="h-24" />
      </div>

      {!selecting && (
        <MobileFab attr="members-invite" icon="lucide:user-plus" label={t("members.toolbar.inviteBtn")} extended={fabExtended}
          disabledReason={greyed(canInvite).title} onTap={whenWritable(() => openPage("share"))} />
      )}
      {picker && (
        <RolePickerSheet title={t("mobile.members.pickRole")} roles={model.roleOptions(selected, picker)} mode="pick"
          selectedIds={picker === "assign" ? roles.filter(heldByAll).map((r) => r.id) : []} disabledReason={pickReason}
          onPick={(r) => { void model.changeRole(selected, r, picker, { bulk: selected.length > 1 }); clear(); }}
          onClose={() => setPicker(null)} />
      )}
      {inviteFor && (
        <PendingInviteActionsSheet teamId={teamId} inv={inviteFor} onDone={() => void model.reload()} onClose={() => setInviteFor(null)} />
      )}
      {offboarding && (
        <OffboardingDialog members={offboarding} teamId={teamId} mode="remove"
          onClose={() => setOffboarding(null)} onDone={() => { clear(); void model.reload(); }} />
      )}
    </>,
  );
}
