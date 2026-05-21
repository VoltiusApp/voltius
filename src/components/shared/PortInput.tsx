import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DropdownMenuItem } from "./DropdownMenuItem";
import { formInputClass, formInputStyle } from "./Panel";

interface Props {
  value: string;
  ports: { name: string; path: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export function PortInput({ value, ports, onChange, placeholder = "/dev/ttyUSB0 or COM3", className = "", autoFocus }: Props) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = ports.filter(
    (p) => !value || p.name.toLowerCase().includes(value.toLowerCase()) || p.path.toLowerCase().includes(value.toLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!inputRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const showDropdown = () => {
    if (!inputRef.current || ports.length === 0) return;
    const r = inputRef.current.getBoundingClientRect();
    setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width });
    setOpen(true);
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
        onFocus={(e) => { e.currentTarget.style.borderColor = "var(--t-accent)"; showDropdown(); }}
        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
        placeholder={placeholder}
        className={`w-full ${formInputClass}`}
        style={{ ...formInputStyle }}
      />
      {open && filtered.length > 0 && createPortal(
        <div
          ref={menuRef}
          className="fixed p-1.5 rounded-xl z-[9999] flex flex-col bg-[var(--t-bg-card)] border border-[var(--t-bg-card-hover)] max-h-[240px] overflow-y-auto"
          style={{ top: menuRect.top, left: menuRect.left, width: menuRect.width, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
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
        </div>,
        document.body,
      )}
    </div>
  );
}
