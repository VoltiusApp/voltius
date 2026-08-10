import { Icon } from "@iconify/react";

export const ROLE_META: Record<string, { label: string; color: string; bg: string }> = {
  owner:          { label: "Owner",        color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  manager:        { label: "Manager",      color: "#60a5fa", bg: "rgba(96,165,250,0.12)"  },
  editor:         { label: "Editor",       color: "#34d399", bg: "rgba(52,211,153,0.12)"  },
  member:         { label: "Member",       color: "var(--t-text-secondary)", bg: "var(--t-bg-elevated)" },
  "connect-only": { label: "Connect-Only", color: "#f59e0b", bg: "rgba(245,158,11,0.12)"  },
};

/**
 * Chip colours for a role: its own colour wins, then the built-in palette,
 * then the caller's fallback.
 */
export function roleChipColors(name: string, override?: string | null, fallback = "var(--t-accent)") {
  const meta = ROLE_META[name];
  const color = override ?? meta?.color ?? fallback;
  return { meta, color, bg: meta?.bg ?? `${color}1a` };
}

const VARIANT_CLASS = {
  pill: "text-[10px] px-2 py-0.5 rounded-full font-medium transition-all",
  chip: "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
  "chip-sm": "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all",
} as const;

interface RoleToggleChipProps {
  name: string;
  active: boolean;
  onClick: () => void;
  /** "pill" is the bare filter/row chip; the "chip" variants carry a tick. */
  variant?: keyof typeof VARIANT_CLASS;
  color?: string | null;
  fallbackColor?: string;
  disabled?: boolean;
}

export function RoleToggleChip({
  name, active, onClick, variant = "chip", color: override, fallbackColor, disabled,
}: RoleToggleChipProps) {
  const { color, bg } = roleChipColors(name, override, fallbackColor);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={VARIANT_CLASS[variant]}
      style={{
        background: active ? bg : "var(--t-bg-elevated)",
        color: active ? color : "var(--t-text-dim)",
        border: `1px solid ${active ? `${color}44` : "var(--t-border)"}`,
      }}
    >
      {variant !== "pill" && active && <Icon icon="lucide:check" width={9} />}
      {name}
    </button>
  );
}
