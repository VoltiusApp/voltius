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
      className="btn btn-secondary w-full flex items-start gap-3 px-4 py-3 rounded-lg text-left"
      style={{
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled && danger) {
          (e.currentTarget as HTMLButtonElement).style.boxShadow =
            "0 0 0 1px color-mix(in srgb, var(--t-status-error) 70%, transparent), 0 2px 8px -4px rgba(0,0,0,0.5)";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = "";
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
        <p className="text-xs mt-0.5 text-(--t-text-dim)">{sub}</p>
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
      className="form-input w-full px-3 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
      onFocus={(e) => {
        (e.currentTarget as HTMLInputElement).style.borderColor = "var(--t-accent)";
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLInputElement).style.borderColor = "var(--t-border)";
      }}
    />
  );
}

export function DirtyDot() {
  return (
    <span
      aria-hidden
      title="Modified from default"
      className="inline-block shrink-0 rounded-full"
      style={{ width: 5, height: 5, background: "var(--t-accent)" }}
    />
  );
}

export function ResetButton({ onReset }: { onReset: () => void }) {
  return (
    <button
      onClick={onReset}
      className="p-1 rounded-sm transition-opacity opacity-0 group-hover:opacity-100 text-(--t-text-muted)"
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-bright)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-muted)"; }}
      title="Reset to default"
    >
      <Icon icon="lucide:rotate-ccw" width={11} />
    </button>
  );
}

export function FormButtons({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) {
  return (
    <div className="flex gap-2 pt-1">
      <button
        type="button"
        onClick={onCancel}
        className="btn btn-secondary flex-1 py-1.5 rounded-lg text-sm"
      >
        Cancel
      </button>
      <button
        type="submit"
        className="btn btn-primary flex-1 py-1.5 rounded-lg text-sm font-medium"
      >
        {submitLabel}
      </button>
    </div>
  );
}
