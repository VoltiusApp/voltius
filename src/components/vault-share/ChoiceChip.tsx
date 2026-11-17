import { choiceHover, selectableChipStyle } from "@/components/shared/selectableChip";

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
      className={`px-2.5 py-1 rounded-lg text-[11px] disabled:opacity-50 disabled:cursor-not-allowed${choiceHover(selected)}`}
      style={selectableChipStyle(selected)}
    >
      {label}
    </button>
  );
}
