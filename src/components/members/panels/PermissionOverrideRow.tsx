import { useTranslation } from "react-i18next";
import { type Permission, type OverrideState } from "@/services/permissions";
import { permissionLabel } from "@/components/members/roleChips";
import { OVERRIDE_STATE_COLOR, TriStateToggle, type TriStateToggleSize } from "@/components/shared/TriStateToggle";

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
  toggleSize?: TriStateToggleSize;
}

export function PermissionOverrideRow({
  permission, state, inheritedFrom, granted, exceptions = false, disabled, onChange, label, note, toggleSize,
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
        <p className={`text-[10px] text-(--t-text-dim) ${toggleSize === "touch" ? "line-clamp-2" : "truncate"}`}>
          {note ?? source}
          {!note && (
            <> · <span className="font-medium" style={{ color: OVERRIDE_STATE_COLOR[granted ? "allow" : "deny"] }}>
              {granted ? t("members.permissions.effectiveAllowed") : t("members.permissions.effectiveDenied")}
            </span>{exceptions && <> {t("members.permissions.withExceptions")}</>}</>
          )}
        </p>
      </div>
      <TriStateToggle value={state} onChange={onChange} label={shown} disabled={disabled} size={toggleSize} />
    </div>
  );
}

export function PermissionOverrideGroups({ groups, onChange, toggleSize }: {
  groups: { key: string; rows: Omit<PermissionOverrideRowProps, "onChange">[] }[];
  onChange: (permission: Permission, next: OverrideState) => void;
  toggleSize?: TriStateToggleSize;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.key}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-(--t-text-dim) opacity-70 mb-0.5">
            {t(`members.permissions.group.${g.key}`)}
          </p>
          {g.rows.map((row) => (
            <PermissionOverrideRow
              key={row.permission}
              {...row}
              toggleSize={toggleSize}
              onChange={(next) => onChange(row.permission, next)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
