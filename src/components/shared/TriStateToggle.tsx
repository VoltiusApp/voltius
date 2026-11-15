import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { OverrideState } from "@/services/permissions";

export const OVERRIDE_STATE_COLOR: Record<OverrideState, string> = {
  deny: "var(--t-status-error)",
  inherit: "var(--t-text-dim)",
  allow: "var(--t-status-connected)",
};

const STATES: { value: OverrideState; icon: string }[] = [
  { value: "deny", icon: "lucide:x" },
  { value: "inherit", icon: "lucide:minus" },
  { value: "allow", icon: "lucide:check" },
];

export function TriStateToggle({ value, onChange, label, disabled = false }: {
  value: OverrideState;
  onChange: (next: OverrideState) => void;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex shrink-0 rounded-lg overflow-hidden bg-(--t-bg-base) border border-(--t-border-hover) divide-x divide-(--t-border-hover)"
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
            className="px-2.5 py-1 transition-colors"
            style={{
              background: active ? "var(--t-bg-elevated)" : "transparent",
              color: active ? OVERRIDE_STATE_COLOR[s.value] : "var(--t-text-dim)",
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <Icon icon={s.icon} width={12} />
          </button>
        );
      })}
    </div>
  );
}
