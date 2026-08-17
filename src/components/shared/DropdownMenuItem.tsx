import { Icon } from "@iconify/react";
import type { ReactNode } from "react";
import { useRipple } from "@/hooks/useRipple";

interface Props {
  icon?: string;
  label: string;
  onClick: () => void;
  checked?: boolean;
  iconSize?: number;
  sublabel?: string;
  /**
   * Secondary control shown at the item's right edge. Kept a sibling of the
   * button, never a child — a button inside a button is invalid DOM.
   */
  trailing?: ReactNode;
}

export function DropdownMenuItem({ icon, label, onClick, checked, iconSize = 20, sublabel, trailing }: Props) {
  const { createRipple, rippleEls } = useRipple();
  const item = (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={createRipple}
      className="w-full flex items-center gap-2.5 p-3 rounded-lg text-md font-medium-bold transition-colors whitespace-nowrap text-(--t-text-secondary) bg-transparent relative overflow-hidden"
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
      <span className="flex-1 min-w-0 text-left">
        <span className="block truncate text-(--t-text-primary)">{label}</span>
        {sublabel && <span className="block text-[10px] text-(--t-text-dim)">{sublabel}</span>}
      </span>
      {checked && (
        <span className="[&_path]:stroke-[2.5]">
          <Icon icon="lucide:check" width={14} />
        </span>
      )}
    </button>
  );

  if (!trailing) return item;
  return (
    <div className="group relative flex items-center">
      {item}
      <div className="absolute right-2 flex items-center">{trailing}</div>
    </div>
  );
}
