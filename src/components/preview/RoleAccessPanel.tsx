import { useState } from "react";
import { Icon } from "@iconify/react";
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

export function RoleAccessPanel() {
  const { t } = useTranslation();
  const session = usePreviewStore((s) => s.session);
  const result = usePreviewStore((s) => s.result);
  const draft = usePreviewStore((s) => s.draft);
  const teamId = session?.teamId ?? "";
  const roleId = session?.subject.type === "role" ? session.subject.role_id : "";
  const role = useTeamStore((s) => s.rolesByTeam[teamId])?.find((r) => r.id === roleId);
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
        <PermissionGrid value={shown} onChange={update} readOnly={!editable} />
      </div>
      {affected.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-(--t-text-secondary)"
          >
            <Icon icon={expanded ? "lucide:chevron-down" : "lucide:chevron-right"} width={11} />
            {t("members.viewAs.affects", { count: affected.length })}
          </button>
          {expanded && <p className="mt-1 text-[11px] text-(--t-text-dim)">{names.join(", ")}</p>}
        </div>
      )}
    </div>
  );
}
