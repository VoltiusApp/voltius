import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import RowActionsButton from "./RowActionsButton";
import { useLongPress } from "./useLongPress";

const noop = () => {};

export interface MobileListRowProps {
  attr: string;
  id: string;
  leading: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onTap: () => void;
  onLong?: () => void;
  actionsLabel?: string;
  onActions?: () => void;
  selecting?: boolean;
  selected?: boolean;
  selectDisabledReason?: string | null;
  disabled?: boolean;
  disabledReason?: string | null;
}

export default function MobileListRow({
  attr, id, leading, title, subtitle, trailing, onTap, onLong, actionsLabel, onActions,
  selecting, selected, selectDisabledReason, disabled, disabledReason,
}: MobileListRowProps) {
  const selectBlocked = !!selecting && !!selectDisabledReason;
  const blocked = !!disabled || selectBlocked;
  const press = useLongPress(onLong ?? noop, blocked ? undefined : onTap);
  const subLine = selectBlocked ? selectDisabledReason : disabled ? disabledReason : subtitle;
  const checked = !!selecting && !!selected;

  return (
    <div
      className="relative flex items-center"
      {...{ [`data-${attr}`]: id }}
      style={{ background: checked ? "color-mix(in srgb, var(--t-accent) 14%, transparent)" : undefined }}
    >
      <button
        className="flex-1 flex items-center gap-4 min-h-[72px] px-4 py-2 text-left min-w-0 aria-disabled:opacity-60"
        aria-haspopup={onActions ? "menu" : undefined}
        aria-disabled={blocked || undefined}
        {...press}
      >
        {selecting ? (
          <span
            role="checkbox"
            aria-checked={checked}
            aria-disabled={selectBlocked || undefined}
            className="w-10 h-10 shrink-0 flex items-center justify-center"
          >
            <Icon
              icon={checked ? "lucide:circle-check" : "lucide:circle"}
              width={22}
              style={{ color: checked ? "var(--t-accent)" : "var(--t-text-dim)" }}
            />
          </span>
        ) : leading}
        <span className="flex-1 flex flex-col min-w-0">
          <span className="flex items-center gap-1.5 min-w-0 text-base font-medium text-(--t-text-primary)">
            {typeof title === "string" ? <span className="truncate">{title}</span> : title}
          </span>
          {subLine && <span className="text-sm text-(--t-text-dim) truncate">{subLine}</span>}
        </span>
        {trailing}
      </button>
      {onActions && actionsLabel && (
        <RowActionsButton attr={`data-${attr}-actions`} value={id} label={actionsLabel} name={typeof title === "string" ? title : id} onTap={onActions} />
      )}
    </div>
  );
}
