import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { FormSection } from "@/components/shared/Panel";
import { MemberPermissionsLock } from "@/components/shared/BusinessLockBanner";
import { MemberRoleChips } from "@/components/members/panels/MemberRoleChips";
import { PermissionOverrideRow, overrideStateOf, applyOverrideState, type OverrideState } from "@/components/members/panels/PermissionOverrideRow";
import { permissionLabel, readOnlyReasonText, roleLabel, rolesGranting } from "@/components/members/roleChips";
import { useSubjectLabel } from "@/components/preview/PreviewScope";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { useMyUserId } from "@/hooks/useMyUserId";
import { heldBits, useOwnPermissions } from "@/hooks/usePermission";
import type { MemberDraft } from "@/services/permissionPreview";
import {
  PERM_BITS, PERMISSION_GROUPS, effectivePermissions, hasBuiltinRole, overrideRowLocked,
  memberReadOnly, isEditablePermission, type Permission,
} from "@/services/permissions";
import { useTeamStore } from "@/stores/teamStore";
import { isMobileShell } from "@/utils/platform";
import type { TeamRole } from "@/stores/teamStore";
import { saveNeedsConfirm, usePreviewStore } from "@/stores/previewStore";
import { unsavedChangeCount, type SaveFailure } from "@/services/viewAsSave";
import { shownPreview, subjectRecord } from "@/services/previewSnapshot";

const NO_ROLES: TeamRole[] = [];

const changedFrom = <T,>(saved: T, shown: T): boolean => saved !== shown;

const draftNote = (t: TFunction, from: OverrideState, to: OverrideState): string | undefined =>
  changedFrom(from, to)
    ? t("members.viewAs.draftChange", { from: t(`members.permissions.state.${from}`), to: t(`members.permissions.state.${to}`) })
    : undefined;

function SaveFailures({ failures, roles }: { failures: SaveFailure[]; roles: TeamRole[] }) {
  const { t } = useTranslation();
  if (failures.length === 0) return null;
  return (
    <ul className="space-y-1 px-1 text-[11px]" style={{ color: "var(--t-status-error)" }}>
      {failures.map((f) => {
        const role = roles.find((r) => r.id === f.roleId);
        const step = t(`members.viewAs.step.${f.step}`, { role: role ? roleLabel(t, role.name) : f.roleId });
        return <li key={`${f.step}:${f.roleId ?? ""}`}>{step}: {f.message}</li>;
      })}
    </ul>
  );
}

export function MemberAccessPanel() {
  const { t } = useTranslation();
  const session = usePreviewStore((s) => s.session);
  const result = usePreviewStore((s) => s.result);
  const draft = usePreviewStore((s) => s.draft);
  const failures = usePreviewStore((s) => s.saveFailures);
  const name = useSubjectLabel();
  const teamId = session?.teamId ?? "";
  const members = useTeamStore((s) => s.membersByTeam[teamId]);
  const roles = useTeamStore((s) => s.rolesByTeam[teamId]) ?? NO_ROLES;
  const record = useTeamStore((s) => subjectRecord(s, session));
  const member = record && "user_id" in record ? record : undefined;
  const myUserId = useMyUserId();
  const can = useOwnPermissions();
  const { locked } = useBusinessLock(teamId);
  const [showAll, setShowAll] = useState(false);
  if (!session || !member || !result) return null;

  const allow = member.permission_allow ?? 0;
  const deny = member.permission_deny ?? 0;
  const shown: MemberDraft = draft && "role_ids" in draft ? draft : { role_ids: member.role_ids, allow, deny };
  const update = (next: MemberDraft) => usePreviewStore.getState().setDraft(unsavedChangeCount(next, member) === 0 ? null : next);

  const { kind: readOnlyKind, roleBlock, offendingBits, lockedEmpty } = memberReadOnly({
    member,
    viewerRoleIds: members?.find((m) => m.user_id === myUserId)?.role_ids ?? null,
    viewerBits: heldBits(can, session.vaultId),
    canManageMembers: can("MANAGE_MEMBERS", session.vaultId),
    isTargetOwner: hasBuiltinRole(member, "owner", roles),
    isMe: member.user_id === myUserId,
    teamRoles: roles,
    locked,
  });
  const readOnlyReason = readOnlyReasonText(t, readOnlyKind);
  const roleReadOnlyReason = readOnlyReasonText(t, roleBlock);

  const currentBits = result.current.team_bits;
  const shownBits = shownPreview(result).team_bits;
  const memberEffective = effectivePermissions({ ...member, role_ids: shown.role_ids, permission_allow: shown.allow, permission_deny: shown.deny }, roles, locked);
  const grantingRoles = (permission: Permission) => rolesGranting(t, roles, shown.role_ids, locked, permission);

  const groups = PERMISSION_GROUPS.map((g) => ({ key: g.key, permissions: g.permissions.filter((p) => (PERM_BITS[p] & (currentBits | shownBits)) !== 0) }))
    .filter((g) => g.permissions.length > 0);

  const rows = PERMISSION_GROUPS.flatMap((g) => g.permissions).filter((p) => isEditablePermission(p, allow | deny | shown.allow | shown.deny));
  const overrideRows = (showAll ? rows : rows.filter((p) => overrideStateOf(p, allow, deny) !== "inherit" || overrideStateOf(p, shown.allow, shown.deny) !== "inherit"));

  const loseKey = saveNeedsConfirm(result) === "memberKeyLoss";

  return (
    <div data-testid="member-access-panel" className="p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-(--t-text-primary)">{t("members.viewAs.access.title", { name })}</p>
        <p className="text-[11px] text-(--t-text-dim)">{t("members.viewAs.access.subtitle")}</p>
      </div>

      <FormSection label={t("members.viewAs.access.can", { name })}>
        {groups.map((g) => (
          <div key={g.key}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-(--t-text-dim) opacity-70 mb-0.5">
              {t(`members.permissions.group.${g.key}`)}
            </p>
            {g.permissions.map((p) => {
              const has = (shownBits & PERM_BITS[p]) !== 0;
              return (
                <p key={p} className="flex items-center gap-1.5 py-0.5 text-xs" style={{ color: has ? "var(--t-text-primary)" : "var(--t-text-dim)" }}>
                  <Icon icon={has ? "lucide:check" : "lucide:x"} width={11} />
                  {permissionLabel(t, p)}
                  {changedFrom((currentBits & PERM_BITS[p]) !== 0, has) && (
                    <span className="text-[10px] text-(--t-accent)">{t("members.viewAs.draftTag")}</span>
                  )}
                </p>
              );
            })}
          </div>
        ))}
        {loseKey && <p className="text-[11px]" style={{ color: "var(--t-status-error)" }}>{t("members.viewAs.keyLoss", { name })}</p>}
      </FormSection>

      <FormSection label={t("members.roles")}>
        <MemberRoleChips
          teamId={teamId}
          roles={roles}
          roleIds={shown.role_ids}
          readOnlyReason={roleReadOnlyReason}
          showOwner
          ownerReason={t("members.viewAs.ownerElsewhere")}
          onToggle={(role) => update({ ...shown, role_ids: shown.role_ids.includes(role.id) ? shown.role_ids.filter((id) => id !== role.id) : [...shown.role_ids, role.id] })}
        />
      </FormSection>

      <FormSection label={t("members.permissions.title")}>
        <MemberPermissionsLock teamId={teamId} name={name} hasOverrides={(allow | deny) !== 0} />
        {!lockedEmpty && (
          <>
          {readOnlyReason && <p className="text-[10px] text-(--t-text-dim)">{readOnlyReason}</p>}
          {overrideRows.map((p) => (
            <PermissionOverrideRow
              key={p}
              permission={p}
              toggleSize={isMobileShell() ? "touch" : "sm"}
              state={overrideStateOf(p, shown.allow, shown.deny)}
              inheritedFrom={grantingRoles(p)}
              granted={(memberEffective & PERM_BITS[p]) !== 0}
              disabled={locked || overrideRowLocked(readOnlyKind, p, offendingBits)}
              note={draftNote(t, overrideStateOf(p, allow, deny), overrideStateOf(p, shown.allow, shown.deny))}
              onChange={(next) => update({ ...shown, ...applyOverrideState(p, shown.allow, shown.deny, next) })}
            />
          ))}
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-(--t-text-secondary)"
          >
            <Icon icon={showAll ? "lucide:chevron-down" : "lucide:chevron-right"} width={11} />
            {t("members.viewAs.access.allPermissions")}
          </button>
          </>
        )}
      </FormSection>

      <SaveFailures failures={failures} roles={roles} />
    </div>
  );
}
