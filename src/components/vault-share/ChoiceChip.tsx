export function ChoiceChip({
  label,
  selected,
  onClick,
  capitalize = false,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  capitalize?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`px-2.5 py-1 rounded-lg text-[11px] border${capitalize ? " capitalize" : ""}`}
      style={{
        background: selected ? "color-mix(in srgb, var(--t-accent) 10%, transparent)" : "var(--t-bg-elevated)",
        borderColor: selected ? "var(--t-accent)" : "transparent",
        color: selected ? "var(--t-accent)" : "var(--t-text-secondary)",
      }}
    >
      {label}
    </button>
  );
}
