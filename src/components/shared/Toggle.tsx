interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 rounded-full transition-colors border border-(--t-border) disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        width: "2.4rem",
        height: "1.333rem",
        background: checked ? "var(--t-accent)" : "var(--t-bg-input)",
      }}
    >
      <span
        className="absolute top-px rounded-full transition-transform bg-white"
        style={{
          width: "1.067rem",
          height: "1.067rem",
          left: "0.067rem",
          transform: checked ? "translateX(1.067rem)" : "translateX(0)",
        }}
      />
    </button>
  );
}
