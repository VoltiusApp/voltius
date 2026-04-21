import { Icon } from "@iconify/react";
import { useRipple } from "@/hooks/useRipple";

interface Props {
  icon?: string;
  label: string;
  onClick: () => void;
  checked?: boolean;
  iconSize?: number;
}

export function DropdownMenuItem({ icon, label, onClick, checked, iconSize = 20 }: Props) {
  const { createRipple, rippleEls } = useRipple();
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={createRipple}
      className="w-full flex items-center gap-2.5 p-3 rounded-lg text-md font-medium-bold transition-colors whitespace-nowrap text-[var(--t-text-secondary)] bg-transparent relative overflow-hidden"
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)";
      }}
    >
      {rippleEls}
      {icon && <Icon icon={icon} width={iconSize} className="shrink-0" />}
      <span className="flex-1 text-left text-[var(--t-text-primary)]">{label}</span>
      {checked && (
        <span className="[&_path]:[stroke-width:2.5]">
          <Icon icon="lucide:check" width={14} />
        </span>
      )}
    </button>
  );
}
