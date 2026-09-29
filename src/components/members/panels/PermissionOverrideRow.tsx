import { useTranslation } from "react-i18next";
import { type Permission, type OverrideState } from "@/services/permissions";
import { permissionLabel } from "@/components/members/roleChips";
import { TriStateToggle } from "@/components/shared/TriStateToggle";

export { overrideStateOf, applyOverrideState, type OverrideState } from "@/services/permissions";

export interface PermissionOverrideRowProps {
  permission: Permission;
  state: OverrideState;
  inheritedFrom: string[];
  inheritedGrants: boolean;
  disabled: boolean;
  onChange: (next: OverrideState) => void;
  label?: string;
}

export function PermissionOverrideRow({
  permission, state, inheritedFrom, inheritedGrants, disabled, onChange, label,
}: PermissionOverrideRowProps) {
  const { t } = useTranslation();
  const shown = label ?? permissionLabel(t, permission);

  const source = inheritedFrom.length > 0
    ? t("members.permissions.inheritedFrom", { roles: inheritedFrom.join(", ") })
    : t("members.permissions.notGranted");

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-xs text-(--t-text-primary) truncate">{shown}</p>
        <p className="text-[10px] text-(--t-text-dim) truncate">
          {source}
          {state === "inherit" && (
            <> · {inheritedGrants ? t("members.permissions.effectiveAllowed") : t("members.permissions.effectiveDenied")}</>
          )}
        </p>
      </div>
      <TriStateToggle value={state} onChange={onChange} label={shown} disabled={disabled} />
    </div>
  );
}
