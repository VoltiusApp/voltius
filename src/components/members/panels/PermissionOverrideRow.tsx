import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { PERM_BITS, type Permission } from "@/services/permissions";
import { permissionLabel } from "@/components/members/roleChips";

export type OverrideState = "deny" | "inherit" | "allow";

const STATES: { value: OverrideState; icon: string; color: string }[] = [
  { value: "deny",    icon: "lucide:x",     color: "var(--t-status-error)" },
  { value: "inherit", icon: "lucide:minus", color: "var(--t-text-dim)" },
  { value: "allow",   icon: "lucide:check", color: "#34d399" },
];

export function overrideStateOf(permission: Permission, allow: number, deny: number): OverrideState {
  const bit = PERM_BITS[permission];
  if ((deny & bit) !== 0) return "deny";
  if ((allow & bit) !== 0) return "allow";
  return "inherit";
}

export function applyOverrideState(
  permission: Permission,
  allow: number,
  deny: number,
  next: OverrideState,
): { allow: number; deny: number } {
  const bit = PERM_BITS[permission];
  const clearedAllow = allow & ~bit;
  const clearedDeny = deny & ~bit;
  if (next === "allow") return { allow: clearedAllow | bit, deny: clearedDeny };
  if (next === "deny") return { allow: clearedAllow, deny: clearedDeny | bit };
  return { allow: clearedAllow, deny: clearedDeny };
}

export interface PermissionOverrideRowProps {
  permission: Permission;
  state: OverrideState;
  inheritedFrom: string[];
  inheritedGrants: boolean;
  disabled: boolean;
  onChange: (next: OverrideState) => void;
}

export function PermissionOverrideRow({
  permission, state, inheritedFrom, inheritedGrants, disabled, onChange,
}: PermissionOverrideRowProps) {
  const { t } = useTranslation();
  const label = permissionLabel(t, permission);

  const source = inheritedFrom.length > 0
    ? t("members.permissions.inheritedFrom", { roles: inheritedFrom.join(", ") })
    : t("members.permissions.notGranted");

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-xs text-(--t-text-primary) truncate">{label}</p>
        <p className="text-[10px] text-(--t-text-dim) truncate">
          {source}
          {state === "inherit" && (
            <> · {inheritedGrants ? t("members.permissions.effectiveAllowed") : t("members.permissions.effectiveDenied")}</>
          )}
        </p>
      </div>
      <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-lg overflow-hidden" style={{ border: "1px solid var(--t-border)" }}>
        {STATES.map((s) => {
          const active = s.value === state;
          return (
            <button
              key={s.value}
              role="radio"
              aria-checked={active}
              aria-label={t(`members.permissions.state.${s.value}`)}
              disabled={disabled}
              onClick={() => { if (!disabled) onChange(s.value); }}
              className="px-2.5 py-1 transition-colors"
              style={{
                background: active ? "var(--t-bg-elevated)" : "transparent",
                color: active ? s.color : "var(--t-text-dim)",
                opacity: disabled ? 0.5 : 1,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              <Icon icon={s.icon} width={12} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
