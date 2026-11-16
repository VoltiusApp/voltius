import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TeamMember } from "@/stores/teamStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useMembersModel, type MembersModel } from "@/components/members/useMembersModel";
import { groupOverrideRows, useMemberDetailModel } from "@/components/members/panels/useMemberDetailModel";
import { MemberDetailDialogs } from "@/components/members/panels/MemberDetailDialogs";
import { PrimaryOwnerControl } from "@/components/members/panels/MemberDetailPanel";
import { PermissionOverrideGroups } from "@/components/members/panels/PermissionOverrideRow";
import { visibleMemberRoles } from "@/components/members/panels/MemberRoleChips";
import { MemberNameField } from "@/components/members/MemberNameInput";
import { RoleBadges } from "@/components/members/roleBadges";
import { readOnlyReasonText } from "@/components/members/roleChips";
import { MemberPermissionsLock } from "@/components/shared/BusinessLockBanner";
import { useVaultKeyHolders } from "@/components/vault-share/useVaultKeyHolders";
import { useVaultKeyGate } from "@/components/vault-share/useVaultKeyGate";
import { useGreyedUnless } from "@/hooks/useGreyedUnless";
import { whenWritable } from "@/services/previewGuard";
import { inviterLabel, memberLabel, memberNamingSupported, secondaryHandle } from "@/services/memberLabel";
import { formatDate, LONG_DATE } from "@/utils/localeFormat";
import MobilePanelHeader from "../panels/MobilePanelHeader";
import MobileSectionHeading from "../MobileSectionHeading";
import RolePickerSheet from "../sheets/RolePickerSheet";
import { greyedTapProps } from "../tapOrExplain";
import { NavRow } from "./members/MembersRows";

const PAGE = "absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)";
const ACTION = "min-h-12 flex items-center justify-center gap-2 px-4 rounded-xl text-sm font-medium aria-disabled:opacity-45";
const KEY_STATES = {
  held: { icon: "lucide:key-round", label: "mobile.members.keyHeld" },
  awaiting: { icon: "lucide:hourglass", label: "mobile.members.keyAwaiting" },
  none: { icon: "lucide:lock", label: "mobile.members.keyNoAccess" },
} as const;

// The leaving page stays mounted through the pop transition, so only pop while this page is on top.
function popIfTop(teamId: string, userId: string) {
  const { stack, pop } = useMobileNavStore.getState();
  const top = stack[stack.length - 1];
  if (top?.kind === "member" && top.teamId === teamId && top.userId === userId) pop();
}

export default function MobileMemberScreen({ teamId, userId }: { teamId: string; userId: string }) {
  const { t } = useTranslation();
  const team = useMembersModel(teamId);
  const member = team.members.find((m) => m.user_id === userId);
  const gone = !team.loading && !member;
  useEffect(() => { if (gone) popIfTop(teamId, userId); }, [gone, teamId, userId]);

  if (!member) {
    return (
      <div className={PAGE}>
        <MobilePanelHeader title="" />
        <p className="px-4 py-3 text-sm text-(--t-text-dim)">{t("members.loading")}</p>
      </div>
    );
  }
  return <MemberPage team={team} teamId={teamId} member={member} onLeave={() => popIfTop(teamId, userId)} />;
}

function Section({ id, label, danger, children }: { id: string; label: string; danger?: boolean; children: ReactNode }) {
  return (
    <section data-member-section={id}>
      <MobileSectionHeading label={label} danger={danger} />
      {children}
    </section>
  );
}

function ReasonLine({ attr, reason }: { attr: string; reason?: string | null }) {
  return reason ? <span {...{ [`data-${attr}-reason`]: "" }} className="text-xs text-(--t-text-dim)">{reason}</span> : null;
}

function GreyedButton({ attr, reason, onTap, className, style, children }: {
  attr: string; reason?: string | null; onTap: () => void; className: string; style?: CSSProperties; children: ReactNode;
}) {
  return (
    <button {...{ [`data-${attr}`]: "" }} {...greyedTapProps(reason, onTap)} className={`${className} ${ACTION}`} style={style}>
      {children}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-12 flex items-center justify-between gap-4 px-4 text-sm">
      <span className="shrink-0 text-(--t-text-dim)">{label}</span>
      <span className="truncate text-(--t-text-primary)">{value}</span>
    </div>
  );
}

function MemberPage({ team, teamId, member, onLeave }: { team: MembersModel; teamId: string; member: TeamMember; onLeave: () => void }) {
  const { t } = useTranslation();
  const greyed = useGreyedUnless();
  const keys = useVaultKeyHolders(teamId);
  const keyGate = useVaultKeyGate(teamId, member, team.roles, team.canManageMembers);
  const [picking, setPicking] = useState(false);
  const model = useMemberDetailModel({
    member,
    isMe: member.user_id === team.myUserId,
    teamId,
    teamRoles: team.roles,
    canManageMembers: team.canManageMembers,
    canNameMembers: team.canNameMembers,
    isTargetOwner: team.isOwnerMember(member),
    viewer: team.myMember,
    onUpdated: team.reload,
  });
  const { name, roles, overrides, primaryOwner, remove } = model;

  const label = memberLabel(member);
  const readOnlyReason = readOnlyReasonText(t, model.readOnly.kind);
  const keyState = keyGate === false ? "none" : keys.holders?.has(member.user_id) ? "held" : "awaiting";
  const grantReason = greyed(team.canManageMembers).title;
  const removeReason = remove.disabled ? remove.title : null;
  const grant = whenWritable(() => void keys.grant({ userId: member.user_id, label, publicKey: member.public_key }));

  return (
    <div className={PAGE} data-mobile-member={`${teamId}:${member.user_id}`}>
      <MobilePanelHeader title={label} sessionName={secondaryHandle(member) || undefined} />
      <div data-vt-hit-scope className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{ overscrollBehavior: "contain", paddingBottom: "calc(var(--vt-safe-bottom) + 24px)" }}>
        {memberNamingSupported(team.members) && (
          <Section id="name" label={t("members.detail.nameLabel")}>
            <div className="px-4"><MemberNameField name={name} handle={member.handle} touch /></div>
          </Section>
        )}

        <Section id="roles" label={t("members.roles")}>
          <NavRow attr="member-roles" id="roles" icon="lucide:shield" label={<RoleBadges member={member} roles={roles.list} />}
            subtitle={roles.readOnlyReason} onTap={() => setPicking(true)} />
        </Section>

        {overrides.visible && (
          <Section id="permissions" label={t("members.permissions.title")}>
            <div className="px-4">
              <MemberPermissionsLock teamId={teamId} name={label} hasOverrides={overrides.hasOverrides} onRemove={overrides.clear} />
              {!overrides.lockedEmpty && (
                <>
                  {readOnlyReason && <p className="text-xs text-(--t-text-dim) mb-1">{readOnlyReason}</p>}
                  <PermissionOverrideGroups groups={groupOverrideRows(overrides.rows)} onChange={overrides.setState} toggleSize="touch" />
                </>
              )}
            </div>
          </Section>
        )}

        <Section id="info" label={t("members.info")}>
          {keys.holders && keyGate !== undefined && (
            <div data-member-vault-key={keyState} className="min-h-12 flex items-center gap-3 px-4 py-2">
              <Icon icon={KEY_STATES[keyState].icon} width={20} className="shrink-0 text-(--t-text-dim)" />
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="text-sm text-(--t-text-primary)">{t(KEY_STATES[keyState].label)}</span>
                {keyState === "awaiting" && <ReasonLine attr="member-grant-key" reason={grantReason} />}
              </span>
              {keyState === "awaiting" && (
                <GreyedButton attr="member-grant-key" reason={grantReason} onTap={grant} className="btn btn-secondary shrink-0">
                  {t("members.people.grantKey")}
                </GreyedButton>
              )}
            </div>
          )}
          <InfoRow label={t("members.memberSince")} value={formatDate(member.joined_at, LONG_DATE)} />
          {member.invited_by_display_name && (
            <InfoRow label={t("members.invitedBy")} value={inviterLabel(member.invited_by_display_name, team.members)} />
          )}
        </Section>

        {primaryOwner.shown && (
          <Section id="ownership" label={t("members.ownership.title")}>
            <div className="px-4"><PrimaryOwnerControl primaryOwner={primaryOwner} touch /></div>
          </Section>
        )}

        <Section id="danger" label={t("members.dangerZone")} danger>
          {remove.leaveBlocked && <p className="px-4 pb-2 text-xs text-(--t-text-secondary)">{t("members.ownership.leaveBlocked")}</p>}
          <div className="px-4 flex flex-col gap-1.5">
            <GreyedButton attr="member-remove" reason={removeReason} onTap={remove.open} className="w-full border"
              style={{ color: "var(--t-status-error)", borderColor: "color-mix(in srgb, var(--t-status-error) 35%, transparent)" }}>
              <Icon icon={remove.label === "leave" ? "lucide:log-out" : "lucide:user-minus"} width={16} />
              {remove.label === "leave" ? t("members.leaveTeam") : t("members.removeFromTeam")}
            </GreyedButton>
            <ReasonLine attr="member-remove" reason={removeReason} />
          </div>
        </Section>
      </div>

      {picking && (
        <RolePickerSheet title={t("members.roles")} roles={visibleMemberRoles(roles.list, roles.showOwner)} mode="toggle"
          selectedIds={member.role_ids} busyId={roles.busyRoleId} disabledReason={roles.disabledReason} onPick={roles.toggle} onClose={() => setPicking(false)} />
      )}
      <MemberDetailDialogs model={model} member={member} teamId={teamId} onDone={onLeave} />
    </div>
  );
}
