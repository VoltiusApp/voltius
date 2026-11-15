import { useTranslation } from "react-i18next";
import { type Permission, type OverrideState } from "@/services/permissions";
import { permissionLabel } from "@/components/members/roleChips";
import { OVERRIDE_STATE_COLOR, TriStateToggle } from "@/components/shared/TriStateToggle";

export { overrideStateOf, applyOverrideState, type OverrideState } from "@/services/permissions";

export interface PermissionOverrideRowProps {
  permission: Permission;
  state: OverrideState;
  inheritedFrom: string[];
  granted: boolean;
  exceptions?: boolean;
  disabled: boolean;
  onChange: (next: OverrideState) => void;
  label?: string;
  note?: string;
}

export function PermissionOverrideRow({
  permission, state, inheritedFrom, granted, exceptions = false, disabled, onChange, label, note,
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
          {note ?? source}
          {!note && (
            <> · <span className="font-medium" style={{ color: OVERRIDE_STATE_COLOR[granted ? "allow" : "deny"] }}>
              {granted ? t("members.permissions.effectiveAllowed") : t("members.permissions.effectiveDenied")}
            </span>{exceptions && <> {t("members.permissions.withExceptions")}</>}</>
          )}
        </p>
      </div>
      <TriStateToggle value={state} onChange={onChange} label={shown} disabled={disabled} />
    </div>
  );
}
