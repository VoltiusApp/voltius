import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { ToolbarButton, toolbarChevronClass } from "@/components/shared/ToolbarButton";
import { useTranslation } from "react-i18next";
import { DropdownMenuItem } from "@/components/shared/DropdownMenuItem";
import { MenuItemList, isInMenuPortal, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { chevronRotateStyle } from "@/utils/icons";
import { searchMatcher } from "@/utils/search";
import { usePopoverFade } from "@/hooks/useDelayedUnmount";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
}

export type ActionItem =
  | { separator: true; label?: never; icon?: never; onClick?: never }
  | { separator?: false; label: string; icon?: string; onClick?: () => void; children?: ContextMenuItem[]; disabledReason?: string };

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
  menuNote?: ReactNode;
  /** Disables only the chevron, with this text as its tooltip; the main action still runs. */
  menuLocked?: string;
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
  label, onAction, align = "right", disabled, variant = "default", searchable, menuNote, menuLocked,
  ...rest
}: Props<T>) {
  const { t } = useTranslation();
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
      if (ref.current && !ref.current.contains(e.target as Node) && !isInMenuPortal(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const menuItems = items ?? [];
  const selectOptions = options ?? [];
  const matchesQuery = searchMatcher(searchQuery);
  const filteredOptions = selectOptions.filter((o) => matchesQuery(o.label));
  const hasContent = items ? menuItems.length > 0 : selectOptions.length > 0;
  const selectionCount = isMulti ? multiValue.length : 0;
  const fade = usePopoverFade(open && hasContent);

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

  const menuEl = fade.mounted && (
    <div
      className={`surface-float absolute top-full ${align === "left" ? "left-0" : "right-0"} mt-1 z-50 flex flex-col ${fade.className}`}
      style={{ ...fade.style, minWidth: `${(menuWidth / 15).toFixed(3)}rem` }}
    >
      {searchable && (
        <div className="px-1.5 pt-1.5">
          <div className="flex items-center gap-1.5 px-2 h-7 rounded-lg bg-(--t-bg-input) border border-(--t-border)">
            <Icon icon="lucide:search" width={12} className="text-(--t-text-dim) shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("common.placeholder.search")}
              className="flex-1 text-xs bg-transparent outline-hidden text-(--t-text-primary)"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery("")} className="text-(--t-text-dim) hover:text-(--t-text-primary)">
                <Icon icon="lucide:x" width={11} />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="p-1.5 flex flex-col overflow-y-auto max-h-64">
        {items
          ? <MenuItemList
              items={menuItems.flatMap((item, i) => (item.separator ? [] : [{ ...item, divider: menuItems[i - 1]?.separator === true }]))}
              onClose={() => setOpen(false)}
            />
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
              <p className="text-xs text-(--t-text-dim) px-3 py-2">{t("common.state.noResults")}</p>
            )
        }
      </div>
      {menuNote && <div className="px-3 pb-2.5 pt-0.5">{menuNote}</div>}
    </div>
  );

  if (onAction) {
    const fill = variant === "accent" ? "accent" : "neutral";

    return (
      <div className={`relative flex items-center gap-px ${className}`} ref={ref}>
        <ToolbarButton
          variant={fill}
          round={hasContent ? "left" : "all"}
          icon={icon}
          label={label ?? ""}
          compact={!label}
          className="overflow-hidden"
          onClick={onAction}
          disabled={disabled}
        />
        {hasContent && <button
          type="button"
          onClick={() => { if (!menuLocked) setOpen((o) => !o); }}
          aria-disabled={menuLocked ? true : undefined}
          aria-label={menuLocked}
          className={toolbarChevronClass(fill)}
          title={menuLocked ?? t("common.action.moreOptions")}
        >
          <span className="[&_path]:stroke-3">
            <Icon icon="lucide:chevron-down" width={20} style={chevronRotateStyle(open)} />
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
        className="flex items-center gap-1 px-2 h-8 rounded-lg transition-colors text-(--t-text-primary) hover:text-(--t-tab-active-text)"
      >
        <div className="relative">
          <Icon icon={icon} width={24} />
          {selectionCount > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full text-[9px] font-bold px-0.5 leading-none"
              style={{ background: "var(--t-accent)", color: "var(--t-on-accent)" }}
            >
              {selectionCount}
            </span>
          )}
        </div>
        {label && <span className="text-sm font-bold tracking-wider whitespace-nowrap">{label}</span>}
        <span className="[&_path]:stroke-3">
          <Icon
            icon="lucide:chevron-down"
            width={20}
            style={chevronRotateStyle(open)}
          />
        </span>
      </button>

      {menuEl}
    </div>
  );
}
