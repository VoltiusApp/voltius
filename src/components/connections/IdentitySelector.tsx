import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import type { Identity } from "@/types";

interface Props {
  value: string | null;
  identities: Identity[];
  onChange: (id: string | null) => void;
  onGoToKeychain: () => void;
}

export default function IdentitySelector({ value, identities, onChange, onGoToKeychain }: Props) {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number }>({ left: 0, width: 0, maxHeight: 320 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        wrapperRef.current && !wrapperRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const spaceAbove = r.top - 8;
      const goUp = spaceBelow < 150 && spaceAbove > spaceBelow;
      setDropdownPos(goUp
        ? { bottom: window.innerHeight - r.top + 4, left: r.left, width: r.width, maxHeight: Math.min(spaceAbove, 320) }
        : { top: r.bottom + 4, left: r.left, width: r.width, maxHeight: Math.min(spaceBelow, 320) }
      );
    }
    setOpen((o) => !o);
  };

  const selected = identities.find((i) => i.id === value) ?? null;
  const displayLabel = selected ? (selected.name ?? selected.username) : "No identity — inline credentials";

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
          color: selected ? "var(--t-text-primary)" : "var(--t-text-dim)",
        }}
      >
        <Icon
          icon={selected ? "lucide:user-check" : "lucide:user-x"}
          width={14}
          className="text-(--t-text-dim) shrink-0"
        />
        <span className="flex-1 text-left truncate text-xs">{displayLabel}</span>
        <span className="[&_path]:stroke-[2.5]">
          <Icon
            icon="lucide:chevron-down"
            width={14}
            className="text-(--t-text-dim) shrink-0"
            style={{
              transition: "transform 150ms",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
            }}
          />
        </span>
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="surface-float p-1.5 flex flex-col fixed z-9999"
          style={{
            top: dropdownPos.top,
            bottom: dropdownPos.bottom,
            left: dropdownPos.left,
            width: dropdownPos.width,
            maxHeight: dropdownPos.maxHeight,
            overflowY: "auto",
          }}
        >
          {/* No identity option */}
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors"
            style={{
              color: value === null ? "var(--t-accent)" : "var(--t-text-secondary)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            <Icon icon="lucide:user-x" width={13} className="shrink-0" />
            <span className="flex-1 text-left">No identity — inline credentials</span>
            {value === null && (
              <span className="[&_path]:stroke-[2.5]">
                <Icon icon="lucide:check" width={13} />
              </span>
            )}
          </button>

          {/* Identity list */}
          {identities.length > 0 && (
            <div className="my-1 border-t border-t-(--t-bg-card-hover)" />
          )}
          {identities.map((identity) => (
            <button
              key={identity.id}
              type="button"
              onClick={() => { onChange(identity.id); setOpen(false); }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors"
              style={{
                color: value === identity.id ? "var(--t-accent)" : "var(--t-text-secondary)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              <Icon icon="lucide:user" width={13} className="shrink-0" />
              <div className="flex-1 text-left min-w-0">
                <p className="truncate text-(--t-text-primary)">
                  {identity.name ?? identity.username}
                </p>
                {identity.name && (
                  <p className="truncate text-(--t-text-dim)">
                    {identity.username}
                  </p>
                )}
              </div>
              <span className="text-xs shrink-0 text-(--t-text-dim)">
                {identity.key_id ? "key" : "pwd"}
              </span>
              {value === identity.id && (
                <span className="[&_path]:stroke-[2.5]">
                  <Icon icon="lucide:check" width={13} className="text-(--t-accent)" />
                </span>
              )}
            </button>
          ))}

          {/* Footer: go to keychain */}
          <div
            className="mt-1 border-t border-t-(--t-bg-card-hover)"
          />
          <button
            type="button"
            onClick={() => { setOpen(false); onGoToKeychain(); }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors text-(--t-text-dim)"
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--t-accent)";
              (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            <Icon icon="lucide:key-round" width={13} />
            <span className="flex-1 text-left">Manage in Keychain</span>
            <Icon icon="lucide:arrow-right" width={13} />
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
