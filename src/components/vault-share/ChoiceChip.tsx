/**
 * The one selectable chip of the share surface — roles, use counts, lifetimes.
 * Extracted because the same markup, the same accent-mix background and the same
 * `aria-pressed` had been written three times across this folder and would
 * otherwise drift a fourth time.
 */
export function ChoiceChip({
  label,
  selected,
  onClick,
  capitalize = false,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  /** Role names are stored lowercase but read as proper nouns in the UI. */
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
