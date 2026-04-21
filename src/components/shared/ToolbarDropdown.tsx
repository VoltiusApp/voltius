import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { DropdownMenuItem } from "@/components/shared/DropdownMenuItem";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
}

interface Props<T extends string> {
  icon: string;
  value: T;
  options: DropdownOption<T>[];
  menuWidth?: number;
  className?: string;
  onChange: (value: T) => void;
  /** Text label shown beside the icon (e.g. "TERMINAL") */
  label?: string;
  /** If set, the trigger becomes a split button: clicking the label/icon runs this action, clicking the chevron opens the menu */
  onAction?: () => void;
  /** Which side the menu opens from (default: "right") */
  align?: "left" | "right";
}


export function ToolbarDropdown<T extends string>({
  icon, value, options, menuWidth = 160, className = "", onChange,
  label, onAction, align = "right",
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const menuEl = open && options.length > 0 && (
    <div
      className={`absolute top-full ${align === "left" ? "left-0" : "right-0"} p-1.5 mt-1 rounded-xl z-50 flex flex-col bg-[var(--t-bg-card)] border border-[var(--t-bg-card-hover)]`}
      style={{ minWidth: `${(menuWidth / 15).toFixed(3)}rem` }}
    >
      {options.map((opt) => (
        <DropdownMenuItem
          key={opt.value}
          icon={opt.icon}
          label={opt.label}
          iconSize={20}
          checked={value === opt.value}
          onClick={() => { onChange(opt.value); setOpen(false); }}
        />
      ))}
    </div>
  );

  if (onAction) {
    return (
      <div className={`relative flex items-center gap-px ${className}`} ref={ref}>
        <button
          type="button"
          onClick={onAction}
          className="flex items-center gap-2 px-3 h-8 text-sm font-bold tracking-wider transition-colors shrink-0 whitespace-nowrap relative overflow-hidden bg-[var(--t-bg-input)] text-[var(--t-text-primary)] border border-[var(--t-border-hover)] border-r-0 rounded-tl-[0.533rem] rounded-bl-[0.533rem]"
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-input-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-input)")}
        >
          <Icon icon={icon} width={20} />
          {label}
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center justify-center w-8 h-8 transition-colors relative overflow-hidden bg-[var(--t-bg-input)] text-[var(--t-text-primary)] border border-[var(--t-border-hover)] rounded-tr-[0.533rem] rounded-br-[0.533rem]"
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-input-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-input)")}
          title="Select shell"
        >
          <span className="[&_path]:[stroke-width:3]">
            <Icon icon="lucide:chevron-down" width={20} color="white" />
          </span>
        </button>
        {menuEl}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center px-2 h-8 rounded-lg transition-colors text-[var(--t-text-primary)] hover:text-[var(--t-tab-active-text)]"
      >
        <Icon icon={icon} width={24} />
        <span className="[&_path]:[stroke-width:3]">
          <Icon
            icon="lucide:chevron-down"
            width={20}
            style={{ transition: "transform 150ms", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </span>
      </button>

      {menuEl}
    </div>
  );
}
