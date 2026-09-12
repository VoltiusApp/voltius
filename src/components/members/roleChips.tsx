import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { TeamRole } from "@/services/teamService";
// Both from the service, not the hook: @/hooks/usePermission pulls teamService
// and i18n in at runtime, which every consumer of this leaf module would then
// have to mock.
import { PERM_BITS, PERM_META, type Permission } from "@/services/permissions";

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

export function permissionLabel(t: TFunction, permission: Permission): string {
  return t(`members.permission.${permission}`, { defaultValue: PERM_META[permission]?.label ?? permission });
}

/**
 * The precise half of the role explanation: exactly which permissions a role
 * grants, derived from its bits. The plain-language counterpart is
 * `members.roleBlurb.*`, which only the built-in roles have.
 */
export function RolePermissionTooltip({ role, color }: { role: TeamRole; color: string }) {
  const { t } = useTranslation();
  const permLabels = Object.entries(PERM_BITS)
    .filter(([, bit]) => (role.permissions & bit) !== 0)
    .map(([p]) => permissionLabel(t, p as Permission));

  if (permLabels.length === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 mb-1.5 z-50 rounded-lg p-2 text-[10px] min-w-[140px] max-w-[200px] pointer-events-none"
      style={{
        background: "var(--t-bg-card)",
        boxShadow: "var(--t-ring), var(--t-elev-2)",
        color: "var(--t-text-primary)",
      }}
    >
      <p className="font-semibold mb-1 capitalize">{role.name}</p>
      <ul className="space-y-0.5">
        {permLabels.slice(0, 8).map((l) => (
          <li key={l} className="flex items-center gap-1" style={{ color: "var(--t-text-dim)" }}>
            <Icon icon="lucide:check" width={8} style={{ color }} />
            {l}
          </li>
        ))}
        {permLabels.length > 8 && (
          <li style={{ color: "var(--t-text-dim)" }}>{t("members.morePermissions", { count: permLabels.length - 8 })}</li>
        )}
      </ul>
    </div>
  );
}

/**
 * The plain-language half: one line saying what a role is for, shown where a
 * role is being *granted* rather than merely displayed. Only the built-in roles
 * have one, so a custom role renders nothing.
 */
export function RoleBlurb({ name }: { name: string }) {
  const { t } = useTranslation();
  const text = t(`members.roleBlurb.${name}`, { defaultValue: "" });
  if (!text) return null;
  return <p className="text-[11px]" style={{ color: "var(--t-text-secondary)" }}>{text}</p>;
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
  /**
   * Show the plain-language `members.roleBlurb.*` line under an active chip —
   * for the surfaces where a role is being *granted*, not merely displayed.
   * Only the built-in roles have one, so a custom role shows nothing.
   */
  blurb?: boolean;
}

export function RoleToggleChip({
  name, active, onClick, variant = "chip", color: override, fallbackColor, disabled, blurb,
}: RoleToggleChipProps) {
  const { color, bg } = roleChipColors(name, override, fallbackColor);

  const button = (
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

  if (!blurb || !active) return button;
  return (
    <div className="flex flex-col gap-1">
      {button}
      <RoleBlurb name={name} />
    </div>
  );
}
