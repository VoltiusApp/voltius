import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PermissionGrid } from "@/components/members/panels/RolesPanel";
import { roleLabel } from "@/components/members/roleChips";
import { BusinessLockLine } from "@/components/shared/BusinessLockBanner";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { useOwnPermissions } from "@/hooks/usePermission";
import { memberLabel } from "@/services/memberLabel";
import { useTeamStore } from "@/stores/teamStore";
import { usePreviewStore } from "@/stores/previewStore";
import { unsavedChangeCount } from "@/services/viewAsSave";
import { subjectRecord } from "@/services/previewSnapshot";
import { touchSize } from "@/components/mobile/touch";
import { DisclosureToggle } from "@/components/shared/DisclosureToggle";

export function RoleAccessPanel() {
  const { t } = useTranslation();
  const session = usePreviewStore((s) => s.session);
  const result = usePreviewStore((s) => s.result);
  const draft = usePreviewStore((s) => s.draft);
  const teamId = session?.teamId ?? "";
  const record = useTeamStore((s) => subjectRecord(s, session));
  const role = record && "permissions" in record ? record : undefined;
  const members = useTeamStore((s) => s.membersByTeam[teamId]);
  const can = useOwnPermissions();
  const { locked } = useBusinessLock(teamId);
  const [expanded, setExpanded] = useState(false);
  if (!session || !role) return null;

  const shown = draft && "permissions" in draft ? draft.permissions : role.permissions;
  const reason = role.is_builtin
    ? t("members.viewAs.builtinReadOnly")
    : !can("MANAGE_ROLES", teamId) ? t("members.viewAs.manageRolesRequired") : null;
  const editable = !reason && !locked;
  const update = (permissions: number) =>
    usePreviewStore.getState().setDraft(unsavedChangeCount({ permissions }, role) === 0 ? null : { permissions });

  const affected = result?.affected?.changed ?? [];
  const names = affected.map((id) => memberLabel(members?.find((m) => m.user_id === id), id));

  return (
    <div data-testid="role-access-panel" className="p-4 space-y-3">
      <p className="text-sm font-semibold text-(--t-text-primary)">{t("members.viewAs.roleTitle", { name: roleLabel(t, role.name) })}</p>
      {reason && <p className="text-[11px] text-(--t-text-dim)">{reason}</p>}
      {!reason && locked && <BusinessLockLine teamId={teamId} label={t("shared.businessLock.rolesBody")} />}
      <div title={reason ?? undefined} className={editable ? undefined : "opacity-60"}>
        <PermissionGrid value={shown} onChange={update} readOnly={!editable} size={touchSize()} />
      </div>
      {affected.length > 0 && (
        <div>
          <DisclosureToggle
            look="compact"
            open={expanded}
            onToggle={() => setExpanded((v) => !v)}
            label={t("members.viewAs.affects", { count: affected.length })}
          />
          {expanded && <p className="mt-1 text-[11px] text-(--t-text-dim)">{names.join(", ")}</p>}
        </div>
      )}
    </div>
  );
}
