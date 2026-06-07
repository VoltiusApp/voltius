import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { DropdownMenuItem } from "./DropdownMenuItem";
import { formInputStyle } from "./Panel";

interface Option {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  className?: string;
}

export function FormSelect({ value, options, onChange, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen((o) => !o);
  };

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className="form-input w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm"
        style={formInputStyle}
        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
      >
        <span className="text-(--t-text-primary)">{selectedLabel}</span>
        <Icon
          icon="lucide:chevron-down"
          width={14}
          className="text-(--t-text-dim) shrink-0"
          style={{ transition: "transform 150ms", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed p-1.5 rounded-xl z-9999 flex flex-col bg-(--t-bg-card) border border-(--t-bg-card-hover) max-h-[240px] overflow-y-auto"
          style={{ top: menuRect.top, left: menuRect.left, width: menuRect.width, boxShadow: "var(--t-elev-2)" }}
        >
          {options.map((opt) => (
            <DropdownMenuItem
              key={opt.value}
              label={opt.label}
              iconSize={15}
              checked={value === opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            />
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
