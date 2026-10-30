import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import { HOST_PICKER_DENSITY, type HostPickerDensity } from "./HostPickerTree";

export function HostRow({ avatar, name, sub, isSelected, onClick, disabled = false, trailing, density = "compact" }: {
  avatar: ReactNode;
  name: string;
  sub: string;
  isSelected: boolean;
  onClick: () => void;
  disabled?: boolean;
  trailing?: ReactNode;
  density?: HostPickerDensity;
}) {
  const still = isSelected || disabled;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center ${HOST_PICKER_DENSITY[density].row} transition-colors text-left disabled:opacity-60 disabled:cursor-default`}
      style={{ background: isSelected ? "var(--t-bg-card-hover)" : "transparent" }}
      onMouseEnter={(e) => { if (!still) e.currentTarget.style.background = "var(--t-bg-elevated)"; }}
      onMouseLeave={(e) => { if (!still) e.currentTarget.style.background = "transparent"; }}
    >
      {avatar}
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate font-medium text-(--t-text-bright)">{name}</p>
        <p className="text-xs truncate text-(--t-text-secondary)">{sub}</p>
      </div>
      {trailing}
      {isSelected && <Icon icon="lucide:check" width={14} className="text-(--t-accent) shrink-0" />}
    </button>
  );
}
