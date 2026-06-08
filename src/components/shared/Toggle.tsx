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
      className="relative shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        width: "2.4rem",
        height: "1.333rem",
        background: checked ? "var(--t-accent)" : "var(--t-bg-input)",
        boxShadow: "var(--t-ring)",
      }}
    >
      <span
        className="absolute rounded-full transition-transform duration-200"
        style={{
          width: "1.067rem",
          height: "1.067rem",
          top: "0.133rem",
          left: "0.133rem",
          transform: checked ? "translateX(1.067rem)" : "translateX(0)",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
        }}
      />
    </button>
  );
}
