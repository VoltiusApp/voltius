import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { OverrideState } from "@/services/permissions";
import { tint } from "@/components/shared/selectableChip";

export const OVERRIDE_STATE_COLOR: Record<OverrideState, string> = {
  deny: "var(--t-status-error)",
  inherit: "var(--t-text-dim)",
  allow: "var(--t-status-connected)",
};

const ACTIVE_COLOR: Record<OverrideState, string> = { ...OVERRIDE_STATE_COLOR, inherit: "var(--t-text-primary)" };

const STATES: { value: OverrideState; icon: string }[] = [
  { value: "deny", icon: "lucide:x" },
  { value: "inherit", icon: "lucide:minus" },
  { value: "allow", icon: "lucide:check" },
];

const SIZES = {
  sm: { segment: "px-2.5 py-1", icon: 12 },
  touch: { segment: "w-11 h-10 flex items-center justify-center", icon: 16 },
} as const;

export type TriStateToggleSize = keyof typeof SIZES;

export function TriStateToggle({ value, onChange, label, disabled = false, size = "sm" }: {
  value: OverrideState;
  onChange: (next: OverrideState) => void;
  label: string;
  disabled?: boolean;
  size?: TriStateToggleSize;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex shrink-0 rounded-lg overflow-hidden bg-(--t-bg-base) border border-(--t-border) divide-x divide-(--t-border)"
    >
      {STATES.map((s) => {
        const active = s.value === value;
        return (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={t(`members.permissions.state.${s.value}`)}
            disabled={disabled}
            onClick={() => { if (!disabled) onChange(s.value); }}
            className={`${SIZES[size].segment} transition-colors`}
            style={{
              background: active ? tint(ACTIVE_COLOR[s.value], 20) : "transparent",
              boxShadow: active ? `inset 0 0 0 1px ${tint(ACTIVE_COLOR[s.value], 55)}` : undefined,
              color: active ? ACTIVE_COLOR[s.value] : "var(--t-text-dim)",
              opacity: disabled ? 0.5 : active ? 1 : 0.7,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <Icon icon={s.icon} width={SIZES[size].icon} />
          </button>
        );
      })}
    </div>
  );
}
