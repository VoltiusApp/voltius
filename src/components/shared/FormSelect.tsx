import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { DropdownMenuItem } from "./DropdownMenuItem";
import { formInputStyle } from "./Panel";
import { PickerSurface } from "./PickerSurface";

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
}

export function FormSelect({ value, options, onChange, className = "", ariaLabel }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="form-input w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm"
        style={formInputStyle}
      >
        <span className="text-(--t-text-primary)">{selectedLabel}</span>
        <Icon
          icon="lucide:chevron-down"
          width={14}
          className="text-(--t-text-dim) shrink-0"
          style={{ transition: "transform 150ms", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      <PickerSurface open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} title={t("shared.formSelect.title")}>
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
