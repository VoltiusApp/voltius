export function ChoiceChip({
  label,
  selected,
  onClick,
  disabledReason,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  disabledReason?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      disabled={!!disabledReason}
      title={disabledReason}
      className="px-2.5 py-1 rounded-lg text-[11px] border disabled:opacity-50 disabled:cursor-not-allowed"
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
