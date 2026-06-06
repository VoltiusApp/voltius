import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";

const ENCODING_GROUPS: { label: string; options: { value: string; label: string }[] }[] = [
  { label: "Unicode", options: [
    { value: "utf-16le", label: "UTF-16 LE" },
    { value: "utf-16be", label: "UTF-16 BE" },
  ]},
  { label: "Western European", options: [
    { value: "iso-8859-1", label: "ISO-8859-1 (Latin-1)" },
    { value: "iso-8859-15", label: "ISO-8859-15 (Latin-9)" },
    { value: "windows-1252", label: "Windows-1252" },
  ]},
  { label: "Central European", options: [
    { value: "iso-8859-2", label: "ISO-8859-2 (Latin-2)" },
    { value: "windows-1250", label: "Windows-1250" },
  ]},
  { label: "Cyrillic", options: [
    { value: "iso-8859-5", label: "ISO-8859-5" },
    { value: "koi8-r", label: "KOI8-R" },
    { value: "koi8-u", label: "KOI8-U" },
    { value: "windows-1251", label: "Windows-1251" },
    { value: "ibm866", label: "IBM866" },
  ]},
  { label: "Greek", options: [
    { value: "iso-8859-7", label: "ISO-8859-7" },
    { value: "windows-1253", label: "Windows-1253" },
  ]},
  { label: "Hebrew", options: [
    { value: "iso-8859-8", label: "ISO-8859-8" },
    { value: "windows-1255", label: "Windows-1255" },
  ]},
  { label: "Arabic", options: [
    { value: "iso-8859-6", label: "ISO-8859-6" },
    { value: "windows-1256", label: "Windows-1256" },
  ]},
  { label: "Turkish", options: [
    { value: "iso-8859-9", label: "ISO-8859-9" },
    { value: "windows-1254", label: "Windows-1254" },
  ]},
  { label: "Baltic", options: [
    { value: "iso-8859-13", label: "ISO-8859-13" },
    { value: "windows-1257", label: "Windows-1257" },
  ]},
  { label: "Vietnamese", options: [
    { value: "windows-1258", label: "Windows-1258" },
  ]},
  { label: "Chinese Simplified", options: [
    { value: "gbk", label: "GBK / GB2312" },
    { value: "gb18030", label: "GB18030" },
  ]},
  { label: "Chinese Traditional", options: [
    { value: "big5", label: "Big5" },
  ]},
  { label: "Japanese", options: [
    { value: "shift-jis", label: "Shift-JIS" },
    { value: "euc-jp", label: "EUC-JP" },
  ]},
  { label: "Korean", options: [
    { value: "euc-kr", label: "EUC-KR" },
  ]},
];

const ALL_OPTIONS = ENCODING_GROUPS.flatMap((g) => g.options);

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export default function EncodingSelector({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setDropdownPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen((o) => !o);
  };

  const selectedLabel = value ? (ALL_OPTIONS.find((o) => o.value === value)?.label ?? value) : "UTF-8 (default)";

  return (
    <div ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
        style={{
          background: "var(--t-bg-base)",
          border: "1px solid var(--t-border)",
          color: value ? "var(--t-text-primary)" : "var(--t-text-dim)",
        }}
      >
        <Icon icon="lucide:binary" width={14} className="text-(--t-text-dim) shrink-0" />
        <span className="flex-1 text-left truncate text-xs">{selectedLabel}</span>
        <span className="[&_path]:stroke-[2.5]">
          <Icon
            icon="lucide:chevron-down"
            width={14}
            className="text-(--t-text-dim) shrink-0"
            style={{ transition: "transform 150ms", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </span>
      </button>

      {open && createPortal(
        <div
          className="p-1.5 rounded-xl flex flex-col fixed z-9999 bg-(--t-bg-card) border border-(--t-bg-card-hover) overflow-y-auto"
          style={{
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            maxHeight: 320,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          }}
        >
          {/* UTF-8 default */}
          <OptionButton
            icon="lucide:binary"
            label="UTF-8 (default)"
            selected={!value}
            onClick={() => { onChange(""); setOpen(false); }}
          />

          {ENCODING_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="my-1 border-t border-t-(--t-bg-card-hover)" />
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-(--t-text-dim)">
                {group.label}
              </p>
              {group.options.map((opt) => (
                <OptionButton
                  key={opt.value}
                  icon="lucide:binary"
                  label={opt.label}
                  selected={value === opt.value}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                />
              ))}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function OptionButton({ icon, label, selected, onClick }: { icon: string; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors w-full"
      style={{ color: selected ? "var(--t-accent)" : "var(--t-text-secondary)" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    >
      <Icon icon={icon} width={13} className="shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {selected && (
        <span className="[&_path]:stroke-[2.5]">
          <Icon icon="lucide:check" width={13} />
        </span>
      )}
    </button>
  );
}
