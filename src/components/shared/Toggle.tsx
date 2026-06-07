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
      className="relative shrink-0 rounded-full transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        width: "2.4rem",
        height: "1.333rem",
        background: checked
          ? "linear-gradient(180deg, color-mix(in srgb, var(--t-accent) 82%, #fff 18%) 0%, var(--t-accent) 100%)"
          : "var(--t-bg-input)",
        boxShadow: checked
          ? "inset 0 1px 2px rgba(0,0,0,0.18), 0 0 0 1px color-mix(in srgb, var(--t-accent) 50%, #000 50%), 0 2px 8px -2px color-mix(in srgb, var(--t-accent) 55%, transparent)"
          : "inset 0 1px 2px rgba(0,0,0,0.3), 0 0 0 1px color-mix(in srgb, #fff 6%, transparent)",
      }}
    >
      <span
        className="absolute top-px rounded-full transition-transform duration-200"
        style={{
          width: "1.067rem",
          height: "1.067rem",
          left: "0.067rem",
          transform: checked ? "translateX(1.067rem)" : "translateX(0)",
          background: "linear-gradient(180deg, #ffffff 0%, #e8ecf2 100%)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.4), 0 0 0 0.5px rgba(0,0,0,0.06)",
        }}
      />
    </button>
  );
}
