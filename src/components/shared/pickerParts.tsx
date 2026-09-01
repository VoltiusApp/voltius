import type { ReactNode, RefObject } from "react";
import { Icon } from "@iconify/react";
import { formInputClass, formInputStyle } from "./Panel";

/** The field-shaped button every picker opens its surface from. */
export function PickerTrigger({
  buttonRef,
  icon,
  label,
  labelFont,
  filled,
  open,
  onToggle,
  trailing,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  icon: string;
  label: string;
  /** Font stack the label previews itself in, for a trigger that picks a font. */
  labelFont?: string;
  /** Something is selected: the label takes the primary colour. */
  filled: boolean;
  open: boolean;
  onToggle: () => void;
  /** Rendered between the label and the chevron (a key type, a badge…). */
  trailing?: ReactNode;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
      style={{
        background: "var(--t-bg-base)",
        border: "1px solid var(--t-border)",
        color: filled ? "var(--t-text-primary)" : "var(--t-text-dim)",
      }}
    >
      <Icon icon={icon} width={14} className="text-(--t-text-dim) shrink-0" />
      <span className="flex-1 text-left truncate text-xs" style={labelFont ? { fontFamily: labelFont } : undefined}>
        {label}
      </span>
      {trailing}
      <span className="[&_path]:stroke-[2.5]">
        <Icon
          icon="lucide:chevron-down"
          width={14}
          className="text-(--t-text-dim) shrink-0"
          style={{ transition: "transform 150ms", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </span>
    </button>
  );
}

/** A row inside a picker surface, checked when it is the current value. */
export function PickerOption({
  icon,
  label,
  labelFont,
  sublabel,
  badge,
  active,
  onClick,
  labelTone = "inherit",
}: {
  /** Omitted for rows whose label already carries the meaning (a font preview). */
  icon?: string;
  label: string;
  /** Font stack the label previews itself in. */
  labelFont?: string;
  sublabel?: string;
  badge?: ReactNode;
  active: boolean;
  onClick: () => void;
  /** `primary` gives the label its own colour instead of the row's. */
  labelTone?: "inherit" | "primary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors w-full"
      style={{ color: active ? "var(--t-accent)" : "var(--t-text-secondary)" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {icon && <Icon icon={icon} width={13} className="shrink-0" />}
      <div className="flex-1 text-left min-w-0">
        <p
          className={`truncate${labelTone === "primary" ? " text-(--t-text-primary)" : ""}`}
          style={labelFont ? { fontFamily: labelFont } : undefined}
        >
          {label}
        </p>
        {sublabel && <p className="truncate text-(--t-text-dim)">{sublabel}</p>}
      </div>
      {badge}
      {active && (
        <span className="[&_path]:stroke-[2.5]">
          <Icon icon="lucide:check" width={13} className="text-(--t-accent)" />
        </span>
      )}
    </button>
  );
}

/** Separator between a picker's sections. `edge` drops the top margin. */
export function PickerDivider({ edge }: { edge?: boolean }) {
  return <div className={`${edge ? "mt-1" : "my-1"} border-t border-t-(--t-bg-card-hover)`} />;
}

/** The dimmed action a picker ends with ("Manage in keychain", "New folder"). */
export function PickerFooterAction({
  icon,
  label,
  onClick,
  trailingIcon,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  trailingIcon?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors text-(--t-text-dim)"
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--t-accent)";
        e.currentTarget.style.background = "var(--t-bg-card-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--t-text-dim)";
        e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon icon={icon} width={13} />
      <span className="flex-1 text-left">{label}</span>
      {trailingIcon && <Icon icon={trailingIcon} width={13} />}
    </button>
  );
}

/** The filter box a long picker opens with. */
export function PickerSearch({
  value,
  onChange,
  placeholder,
  autoFocus = true,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <Icon
        icon="lucide:search"
        width={13}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--t-text-dim) pointer-events-none"
      />
      <input
        className={`${formInputClass} pl-7 text-xs`}
        style={formInputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
    </div>
  );
}
