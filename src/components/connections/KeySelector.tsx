import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { SshKey } from "@/types";
import { PickerSurface } from "@/components/shared/PickerSurface";

interface Props {
  value: string | null;
  keys: SshKey[];
  onChange: (id: string | null) => void;
  onGoToKeychain: () => void;
}

export default function KeySelector({ value, keys, onChange, onGoToKeychain }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selected = keys.find((k) => k.id === value) ?? null;
  const displayLabel = selected ? (selected.name ?? "Unnamed Key") : "Inline private key";

  return (
    <div>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
        style={{
          background: "var(--t-bg-base)",
          border: "1px solid var(--t-border)",
          color: selected ? "var(--t-text-primary)" : "var(--t-text-dim)",
        }}
      >
        <Icon
          icon={selected ? "lucide:key" : "lucide:file-key"}
          width={14}
          className="text-(--t-text-dim) shrink-0"
        />
        <span className="flex-1 text-left truncate text-xs">{displayLabel}</span>
        {selected && selected.key_type && (
          <span className="text-[10px] text-(--t-text-dim) shrink-0">{selected.key_type}</span>
        )}
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

      <PickerSurface open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} title="SSH Key">
        <button
          type="button"
          onClick={() => { onChange(null); setOpen(false); }}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors"
          style={{ color: value === null ? "var(--t-accent)" : "var(--t-text-secondary)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
        >
          <Icon icon="lucide:file-key" width={13} className="shrink-0" />
          <span className="flex-1 text-left">Inline private key</span>
          {value === null && (
            <span className="[&_path]:stroke-[2.5]">
              <Icon icon="lucide:check" width={13} />
            </span>
          )}
        </button>

        {keys.length > 0 && (
          <div className="my-1 border-t border-t-(--t-bg-card-hover)" />
        )}
        {keys.map((key) => (
          <button
            key={key.id}
            type="button"
            onClick={() => { onChange(key.id); setOpen(false); }}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors"
            style={{ color: value === key.id ? "var(--t-accent)" : "var(--t-text-secondary)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
          >
            <Icon icon="lucide:key" width={13} className="shrink-0" />
            <div className="flex-1 text-left min-w-0">
              <p className="truncate text-(--t-text-primary)">{key.name ?? "Unnamed Key"}</p>
            </div>
            {key.key_type && (
              <span className="text-[10px] shrink-0 text-(--t-text-dim)">{key.key_type}</span>
            )}
            {value === key.id && (
              <span className="[&_path]:stroke-[2.5]">
                <Icon icon="lucide:check" width={13} className="text-(--t-accent)" />
              </span>
            )}
          </button>
        ))}

        <div className="mt-1 border-t border-t-(--t-bg-card-hover)" />
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
      </PickerSurface>
    </div>
  );
}
