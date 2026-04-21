import { Icon } from "@iconify/react";

export function ActionItem({ icon, label, sub, danger, disabled, onClick }: {
  icon: string;
  label: string;
  sub: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const color = disabled ? "var(--t-text-dim)" : danger ? "var(--t-text-muted)" : "var(--t-text-primary)";

  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className="w-full flex items-start gap-3 px-4 py-3 rounded-lg text-left transition-colors bg-[var(--t-bg-elevated)] border border-[var(--t-border)]"
      style={{
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLButtonElement).style.borderColor = danger
            ? "var(--t-status-error)"
            : "var(--t-border-hover)";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)";
      }}
    >
      <Icon
        icon={icon}
        width={16}
        className="shrink-0"
        style={{ color: danger ? "var(--t-status-error)" : "var(--t-accent)", marginTop: 2 }}
      />
      <div>
        <p className="text-sm font-medium" style={{ color }}>{label}</p>
        <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">{sub}</p>
      </div>
    </button>
  );
}

export function SettingsInput({ type = "text", placeholder, value, onChange, autoFocus }: {
  type?: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors bg-[var(--t-bg-input)] border border-[var(--t-border)] text-[var(--t-text-primary)]"
      onFocus={(e) => {
        (e.currentTarget as HTMLInputElement).style.borderColor = "var(--t-accent)";
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLInputElement).style.borderColor = "var(--t-border)";
      }}
    />
  );
}

export function FormButtons({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) {
  return (
    <div className="flex gap-2 pt-1">
      <button
        type="button"
        onClick={onCancel}
        className="flex-1 py-1.5 rounded-lg text-sm transition-colors bg-[var(--t-bg-elevated)] text-[var(--t-text-muted)]"
      >
        Cancel
      </button>
      <button
        type="submit"
        className="flex-1 py-1.5 rounded-lg text-sm font-medium text-white transition-colors bg-[var(--t-accent)]"
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--t-accent-hover)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--t-accent)";
        }}
      >
        {submitLabel}
      </button>
    </div>
  );
}
