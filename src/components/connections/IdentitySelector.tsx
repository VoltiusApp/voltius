import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { Identity } from "@/types";
import { PickerSurface } from "@/components/shared/PickerSurface";

interface Props {
  value: string | null;
  identities: Identity[];
  onChange: (id: string | null) => void;
  onGoToKeychain: () => void;
}

export default function IdentitySelector({ value, identities, onChange, onGoToKeychain }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selected = identities.find((i) => i.id === value) ?? null;
  const displayLabel = selected ? (selected.name ?? selected.username) : "No identity — inline credentials";

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

      <PickerSurface open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} title="Identity">
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
      </PickerSurface>
    </div>
  );
}
