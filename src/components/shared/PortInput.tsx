import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenuItem } from "./DropdownMenuItem";
import { formInputClass, formInputStyle } from "./Panel";
import { PickerSurface } from "./PickerSurface";

interface Props {
  value: string;
  ports: { name: string; path: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export function PortInput({ value, ports, onChange, placeholder, className = "", autoFocus }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = ports.filter(
    (p) => !value || p.name.toLowerCase().includes(value.toLowerCase()) || p.path.toLowerCase().includes(value.toLowerCase()),
  );

  const showDropdown = () => {
    if (ports.length > 0) setOpen(true);
  };

  useEffect(() => {
    if (ports.length > 0 && document.activeElement === inputRef.current) {
      showDropdown();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ports]);

  return (
    <div className={className}>
      <input
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => { onChange(e.target.value); showDropdown(); }}
        onFocus={() => showDropdown()}
        placeholder={placeholder ?? t("shared.portInput.placeholder")}
        className={`w-full ${formInputClass}`}
        style={{ ...formInputStyle }}
      />
      <PickerSurface
        open={open && filtered.length > 0}
        onClose={() => setOpen(false)}
        anchorRef={inputRef}
        title={t("shared.portInput.placeholder")}
        maxHeight={240}
      >
        {filtered.map((p) => (
          <DropdownMenuItem
            key={p.path}
            label={p.name}
            checked={value === p.path}
            iconSize={15}
            onClick={() => { onChange(p.path); setOpen(false); }}
          />
        ))}
      </PickerSurface>
    </div>
  );
}
