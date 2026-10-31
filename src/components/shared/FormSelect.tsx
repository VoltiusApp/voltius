import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { DropdownMenuItem } from "./DropdownMenuItem";
import { formInputStyle } from "./Panel";
import { PickerSurface } from "./PickerSurface";
import { chevronRotateStyle } from "@/utils/icons";
import { useInListRow, useListRowLabel } from "./listRowContext";

interface Option {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  className?: string;
  /** Accessible name when no visible <label> points at the trigger. */
  ariaLabel?: string;
  disabled?: boolean;
  /** Title of the Android bottom sheet the options open in (the field's label). */
  title?: string;
}

export function FormSelect({ value, options, onChange, className = "", ariaLabel, disabled, title }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;
  // Android settings row: the value is trailing text (M3), the row tap opens the sheet.
  const inRow = useInListRow();
  const rowLabel = useListRowLabel();

  return (
    <div className={inRow ? undefined : className}>
      {inRow ? (
        <button
          ref={triggerRef}
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          data-row-control
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 h-10 pl-3 pr-2 -mr-2 rounded-full text-sm text-(--t-accent) disabled:opacity-50"
        >
          <span className="truncate max-w-[40vw]">{selectedLabel}</span>
          <Icon icon="lucide:chevron-down" width={16} className="shrink-0" />
        </button>
      ) : (
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        data-form-select
        className="form-input w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm disabled:opacity-50"
        style={formInputStyle}
      >
        <span className="text-(--t-text-primary)">{selectedLabel}</span>
        <Icon
          icon="lucide:chevron-down"
          width={14}
          className="text-(--t-text-dim) shrink-0"
          style={chevronRotateStyle(open)}
        />
      </button>
      )}

      <PickerSurface open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} title={title ?? ariaLabel ?? rowLabel ?? t("shared.formSelect.title")}>
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            label={opt.label}
            iconSize={15}
            checked={value === opt.value}
            onClick={() => { onChange(opt.value); setOpen(false); }}
          />
        ))}
      </PickerSurface>
    </div>
  );
}
