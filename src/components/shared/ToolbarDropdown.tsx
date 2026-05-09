import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { DropdownMenuItem } from "@/components/shared/DropdownMenuItem";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
}

export interface ActionItem {
  label: string;
  icon?: string;
  onClick: () => void;
}

interface BaseProps<T extends string> {
  icon: string;
  options?: DropdownOption<T>[];
  items?: ActionItem[];
  menuWidth?: number;
  className?: string;
  label?: string;
  onAction?: () => void;
  align?: "left" | "right";
  disabled?: boolean;
  variant?: "default" | "accent";
  searchable?: boolean;
}

interface SingleSelectProps<T extends string> extends BaseProps<T> {
  multiSelect?: false;
  value?: T;
  onChange?: (value: T) => void;
  multiValue?: never;
  onMultiChange?: never;
}

interface MultiSelectProps<T extends string> extends BaseProps<T> {
  multiSelect: true;
  multiValue: T[];
  onMultiChange: (values: T[]) => void;
  value?: never;
  onChange?: never;
}

type Props<T extends string> = SingleSelectProps<T> | MultiSelectProps<T>;

export function ToolbarDropdown<T extends string>({
  icon, options, items, menuWidth = 160, className = "",
  label, onAction, align = "right", disabled, variant = "default", searchable,
  ...rest
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const isMulti = rest.multiSelect === true;
  const multiValue: T[] = isMulti ? (rest as MultiSelectProps<T>).multiValue : [];
  const onMultiChange = isMulti ? (rest as MultiSelectProps<T>).onMultiChange : undefined;
  const value = !isMulti ? (rest as SingleSelectProps<T>).value : undefined;
  const onChange = !isMulti ? (rest as SingleSelectProps<T>).onChange : undefined;

  useEffect(() => {
    if (!open) { setSearchQuery(""); return; }
    if (searchable) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const menuItems = items ?? [];
  const selectOptions = options ?? [];
  const filteredOptions = searchQuery
    ? selectOptions.filter((o) => o.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : selectOptions;
  const hasContent = items ? menuItems.length > 0 : selectOptions.length > 0;
  const selectionCount = isMulti ? multiValue.length : 0;

  function handleOptionClick(opt: DropdownOption<T>) {
    if (isMulti) {
      if (opt.value === ("" as T)) {
        onMultiChange!([]);
      } else {
        const next = multiValue.includes(opt.value)
          ? multiValue.filter((v) => v !== opt.value)
          : [...multiValue, opt.value];
        onMultiChange!(next);
      }
    } else {
      onChange!(opt.value);
      setOpen(false);
    }
  }

  function isChecked(opt: DropdownOption<T>): boolean {
    if (isMulti) {
      return opt.value === ("" as T) ? multiValue.length === 0 : multiValue.includes(opt.value);
    }
    return value === opt.value;
  }

  const menuEl = open && hasContent && (
    <div
      className={`absolute top-full ${align === "left" ? "left-0" : "right-0"} mt-1 rounded-xl z-50 flex flex-col bg-[var(--t-bg-card)] border border-[var(--t-bg-card-hover)]`}
      style={{ minWidth: `${(menuWidth / 15).toFixed(3)}rem`, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
    >
      {searchable && (
        <div className="px-1.5 pt-1.5">
          <div className="flex items-center gap-1.5 px-2 h-7 rounded-lg bg-[var(--t-bg-input)] border border-[var(--t-border)]">
            <Icon icon="lucide:search" width={12} className="text-[var(--t-text-dim)] shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search…"
              className="flex-1 text-xs bg-transparent outline-none text-[var(--t-text-primary)] placeholder:text-[var(--t-text-dim)]"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery("")} className="text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)]">
                <Icon icon="lucide:x" width={11} />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="p-1.5 flex flex-col overflow-y-auto max-h-64">
        {items
          ? menuItems.map((item) => (
              <DropdownMenuItem
                key={item.label}
                icon={item.icon}
                label={item.label}
                iconSize={15}
                onClick={() => { item.onClick(); setOpen(false); }}
              />
            ))
          : filteredOptions.length > 0
            ? filteredOptions.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  icon={opt.icon}
                  label={opt.label}
                  iconSize={20}
                  checked={isChecked(opt)}
                  onClick={() => handleOptionClick(opt)}
                />
              ))
            : (
              <p className="text-xs text-[var(--t-text-dim)] px-3 py-2">No results</p>
            )
        }
      </div>
    </div>
  );

  if (onAction) {
    const isAccent = variant === "accent";
    const actionBg = isAccent ? "var(--t-accent)" : "var(--t-bg-input)";
    const actionBgHover = isAccent ? "var(--t-accent-hover)" : "var(--t-bg-input-hover)";
    const actionText = isAccent ? "var(--t-bg-terminal)" : "var(--t-text-primary)";
    const actionBorder = isAccent ? "var(--t-accent-hover)" : "var(--t-border-hover)";
    const chevronBg = isAccent ? "var(--t-accent)" : "var(--t-bg-input)";
    const chevronBgHover = isAccent ? "var(--t-accent-hover)" : "var(--t-bg-input-hover)";

    return (
      <div className={`relative flex items-center gap-px ${className}`} ref={ref}>
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          className={`flex items-center gap-2 px-3 h-8 text-sm font-bold tracking-wider transition-colors shrink-0 whitespace-nowrap relative overflow-hidden border ${hasContent ? "border-r-0 rounded-tl-[0.533rem] rounded-bl-[0.533rem]" : "rounded-[0.533rem]"}`}
          style={{
            background: actionBg, color: actionText, borderColor: actionBorder,
            opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "pointer",
          }}
          onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = actionBgHover; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = actionBg; }}
        >
          <Icon icon={icon} width={20} />
          {label}
        </button>
        {hasContent && <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center justify-center w-8 h-8 transition-colors relative overflow-hidden border rounded-tr-[0.533rem] rounded-br-[0.533rem]"
          style={{ background: chevronBg, color: actionText, borderColor: actionBorder }}
          onMouseEnter={(e) => (e.currentTarget.style.background = chevronBgHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = chevronBg)}
          title="More options"
        >
          <span className="[&_path]:[stroke-width:3]">
            <Icon icon="lucide:chevron-down" width={20} style={{ transition: "transform 150ms", transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
          </span>
        </button>}
        {menuEl}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-2 h-8 rounded-lg transition-colors text-[var(--t-text-primary)] hover:text-[var(--t-tab-active-text)]"
      >
        <div className="relative">
          <Icon icon={icon} width={24} />
          {selectionCount > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full text-[9px] font-bold px-0.5 leading-none"
              style={{ background: "var(--t-accent)", color: "var(--t-bg-terminal)" }}
            >
              {selectionCount}
            </span>
          )}
        </div>
        {label && <span className="text-sm font-bold tracking-wider whitespace-nowrap">{label}</span>}
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
