import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useTeamStore } from "@/stores/teamStore";
import type { TeamMember, TeamRole } from "@/stores/teamStore";
import { PanelShell, PanelHeader, PanelHeaderIconButton, FormSection } from "@/components/shared/Panel";
import { permissionLabel, readOnlyReasonText } from "@/components/members/roleChips";
import { MemberRoleChips } from "@/components/members/panels/MemberRoleChips";
import { AccessSummaryCard } from "@/components/members/panels/AccessSummaryCard";
import { useViewAsEntry } from "@/components/preview/useViewAsEntry";
import { isMobileShell } from "@/utils/platform";
import { MemberPermissionsLock } from "@/components/shared/BusinessLockBanner";
import { RoleBadges } from "@/components/members/roleBadges";
import { PermissionOverrideRow } from "./PermissionOverrideRow";
import { formatDate } from "@/utils/localeFormat";
import { searchMatcher } from "@/utils/search";
import { MemberNameInput } from "@/components/members/MemberNameInput";
import { inviterLabel, memberLabel, secondaryHandle } from "@/services/memberLabel";
import { refuseWhilePreviewing } from "@/services/previewGuard";
import { groupOverrideRows, useMemberDetailModel } from "./useMemberDetailModel";
import { MemberDetailDialogs } from "./MemberDetailDialogs";

export interface MemberDetailPanelProps {
  member: TeamMember;
  isMe: boolean;
  teamId: string;
  teamRoles: TeamRole[];
  canManageMembers: boolean;
  canNameMembers: boolean;
  namingSupported?: boolean;
  isTargetOwner: boolean;
  viewer?: TeamMember;
  onClose: () => void;
  onUpdated: () => void;
}

export function MemberDetailPanel({ onClose, ...props }: MemberDetailPanelProps) {
  const { member, teamId, teamRoles, canNameMembers, namingSupported = canNameMembers } = props;
  const { t } = useTranslation();
  const model = useMemberDetailModel(props);
  const { name, roles, overrides, primaryOwner, remove } = model;
  const viewAs = useViewAsEntry(teamId, { type: "member", user_id: member.user_id });
  const showViewAs = !isMobileShell();
  const roster = useTeamStore((s) => s.membersByTeam[teamId]);
  const [permissionFilter, setPermissionFilter] = useState("");

  const matchesFilter = searchMatcher(permissionFilter);
  const filteredGroups = groupOverrideRows(overrides.rows, (p) => matchesFilter(permissionLabel(t, p)));
  const readOnlyReason = readOnlyReasonText(t, model.readOnly.kind);
  const joinedDate = formatDate(member.joined_at, { year: "numeric", month: "long", day: "numeric" });

  return (
    <>
    <PanelShell>
      <PanelHeader
        icon="lucide:user"
        title={memberLabel(member)}
        subtitle={<>{secondaryHandle(member) && <span className="mr-2">{secondaryHandle(member)}</span>}<RoleBadges member={member} roles={teamRoles} /></>}
        saveState={canNameMembers ? name.saveState : undefined}
        actions={showViewAs && (
          <PanelHeaderIconButton
            icon="lucide:scan-eye"
            {...viewAs.button}
            title={viewAs.button.title ?? t("members.viewAs.viewAs")}
          />
        )}
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {showViewAs && <AccessSummaryCard teamId={teamId} member={member} />}
        {namingSupported && (
          <FormSection label={t("members.detail.nameLabel")}>
            <MemberNameInput
              aria-label={t("members.detail.nameLabel")}
              value={name.value}
              placeholder={member.handle ? `@${member.handle}` : ""}
              readOnly={name.readOnly}
              title={name.title}
              onFocus={() => { refuseWhilePreviewing(); }}
              onChange={(e) => name.setValue(e.target.value)}
              onBlur={name.commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") name.commit();
                if (e.key === "Escape") name.revert();
              }}
            />
            {name.error && <p className="text-[11px] mt-1.5" style={{ color: "var(--t-status-error)" }}>{name.error}</p>}
            <p className="text-[11px] mt-1.5" style={{ color: "var(--t-text-secondary)" }}>{t("members.detail.nameHint")}</p>
          </FormSection>
        )}

        {/* Roles */}
        <FormSection label={t("members.roles")}>
          <MemberRoleChips
            teamId={teamId}
            roles={roles.list}
            roleIds={member.role_ids}
            readOnlyReason={roles.readOnlyReason}
            onToggle={roles.toggle}
            showOwner={roles.showOwner}
            busyRoleId={roles.busyRoleId}
            flashRoleId={roles.flashRoleId}
          >
            {!model.locked && (
            <button
              onClick={roles.create}
              disabled={model.readOnly.roleBlock !== null}
              title={roles.readOnlyReason ?? undefined}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ color: "var(--t-accent)", border: "1px dashed var(--t-accent)", background: "transparent", opacity: 0.7 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.7"; }}
            >
              <Icon icon="lucide:plus" width={10} />
              {t("members.newRole")}
            </button>
            )}
          </MemberRoleChips>
        </FormSection>

        {/* Permissions */}
        {overrides.visible && (
        <FormSection label={t("members.permissions.title")}>
          <MemberPermissionsLock
            teamId={teamId}
            name={memberLabel(member)}
            hasOverrides={overrides.hasOverrides}
            onRemove={overrides.clear}
          />
          {!overrides.lockedEmpty && (
            <>
            {readOnlyReason && (
              <p className="text-[10px] text-(--t-text-dim) mb-1">{readOnlyReason}</p>
            )}
            {overrides.rows.length > 6 && (
              <div className="relative mb-2">
                <Icon icon="lucide:search" width={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--t-text-dim)" }} />
                <input
                  value={permissionFilter}
                  onChange={(e) => setPermissionFilter(e.target.value)}
                  placeholder={t("members.permissions.filterPlaceholder")}
                  className="w-full pl-8 pr-7 py-1.5 rounded-lg outline-hidden bg-(--t-bg-input) border border-(--t-border-hover) text-(--t-text-primary)"
                  style={{ fontSize: 12 }}
                />
                {permissionFilter && (
                  <button onClick={() => setPermissionFilter("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70">
                    <Icon icon="lucide:x" width={12} style={{ color: "var(--t-text-dim)" }} />
                  </button>
                )}
              </div>
            )}
            {filteredGroups.length === 0 && (
              <p className="text-xs text-(--t-text-dim) px-1 py-2">{t("common.state.noResults")}</p>
            )}
            <div className="space-y-4">
              {filteredGroups.map((g) => (
                <div key={g.key}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-(--t-text-dim) opacity-70 mb-0.5">
                    {t(`members.permissions.group.${g.key}`)}
                  </p>
                  {g.rows.map((row) => (
                    <PermissionOverrideRow
                      key={row.permission}
                      {...row}
                      onChange={(next) => overrides.setState(row.permission, next)}
                    />
                  ))}
                </div>
              ))}
            </div>
            </>
          )}
        </FormSection>
        )}

        {primaryOwner.shown && (
          <FormSection label={t("members.ownership.title")}>
            {primaryOwner.isPrimary ? (
              <div className="text-xs">
                <p className="flex items-center gap-1.5 font-medium text-(--t-text-primary)">
                  <Icon icon="lucide:crown" width={12} />
                  {t("members.ownership.primary")}
                </p>
                <p className="text-[11px] mt-1 text-(--t-text-secondary)">
                  {t(primaryOwner.billingEnabled ? "members.ownership.primaryHintBilling" : "members.ownership.primaryHintSelfHosted")}
                </p>
              </div>
            ) : (
              <button
                onClick={primaryOwner.make}
                className="btn btn-secondary w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
              >
                <Icon icon="lucide:crown" width={13} />
                {t("members.ownership.makePrimary")}
              </button>
            )}
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
                <span className="text-(--t-text-primary) truncate">{inviterLabel(member.invited_by_display_name, roster)}</span>
              </div>
            )}
          </div>
        </FormSection>

        {remove.leaveBlocked && (
          <p className="text-[11px] px-1 text-(--t-text-secondary)">{t("members.ownership.leaveBlocked")}</p>
        )}

        {/* Danger zone */}
        <FormSection label={t("members.dangerZone")}>
          <button
            onClick={remove.open}
            disabled={remove.disabled}
            title={remove.title}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: "var(--t-bg-elevated)",
              color: "var(--t-status-error)",
              border: "1px solid rgba(239,68,68,0.3)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--t-bg-elevated)"; }}
          >
            <Icon icon={remove.label === "leave" ? "lucide:log-out" : "lucide:user-minus"} width={13} />
            {remove.label === "leave" ? t("members.leaveTeam") : t("members.removeFromTeam")}
          </button>
        </FormSection>

        {model.error && <p className="text-xs px-1" style={{ color: "var(--t-status-error)" }}>{model.error}</p>}
      </div>
    </PanelShell>

    <MemberDetailDialogs model={model} member={member} teamId={teamId} onDone={onClose} />
    </>
  );
}
