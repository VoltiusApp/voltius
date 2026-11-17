import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { TeamRole } from "@/stores/teamStore";
import { RoleBlurb, roleLabel, roleToggleStyle } from "@/components/members/roleChips";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { isOwnerRole } from "@/components/vault-share/vaultShareModel";

export interface MemberRoleChipsProps {
  teamId: string;
  roles: TeamRole[];
  roleIds: string[];
  readOnlyReason: string | null;
  onToggle: (role: TeamRole) => void;
  showOwner: boolean;
  ownerReason?: string;
  busyRoleId?: string | null;
  flashRoleId?: string | null;
  size?: "sm" | "touch";
  children?: ReactNode;
}

const FLASH_COLOR = "#34d399";

export function roleChipBlockReason(t: TFunction, role: TeamRole, o: {
  hasRole: boolean; locked: boolean; readOnlyReason: string | null; ownerReason?: string;
}): string | null {
  if (o.locked && !role.is_builtin && !o.hasRole) return t("shared.businessLock.title");
  if (o.ownerReason !== undefined && isOwnerRole(role)) return o.ownerReason;
  return o.readOnlyReason;
}

export const visibleMemberRoles = (roles: TeamRole[], showOwner: boolean) =>
  roles.filter((r) => !isOwnerRole(r) || showOwner).sort((a, b) => a.position - b.position);

export function MemberRoleChips({
  teamId, roles, roleIds, readOnlyReason, onToggle, showOwner, ownerReason, busyRoleId = null, flashRoleId = null, size = "sm", children,
}: MemberRoleChipsProps) {
  const { t } = useTranslation();
  const { locked } = useBusinessLock(teamId);
  const touch = size === "touch";

  return (
    <div data-chip-group className="flex flex-wrap items-start gap-2">
      {visibleMemberRoles(roles, showOwner).map((role) => {
          const hasRole = roleIds.includes(role.id);
          const blockReason = roleChipBlockReason(t, role, { hasRole, locked, readOnlyReason, ownerReason });
          const flashed = flashRoleId === role.id;
          const busy = busyRoleId === role.id;
          return (
            <div key={role.id} className="flex flex-col gap-1">
              <button
                onClick={() => onToggle(role)}
                disabled={busy || blockReason !== null}
                title={blockReason ?? undefined}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all${touch ? " min-h-12" : ""}`}
                aria-pressed={hasRole}
                style={{
                  ...roleToggleStyle(role.name, flashed || hasRole, flashed ? FLASH_COLOR : role.color),
                  opacity: busy ? 0.6 : 1,
                  transition: "background 0.3s, color 0.3s, border-color 0.3s",
                }}
              >
                {busy
                  ? <Icon icon="lucide:loader-circle" width={10} className="animate-spin" />
                  : flashed
                    ? <Icon icon="lucide:check-check" width={10} />
                    : hasRole
                      ? <Icon icon="lucide:check" width={10} />
                      : null
                }
                {roleLabel(t, role.name)}
                {role.is_builtin
                  ? <Icon icon="lucide:lock" width={9} style={{ color: "var(--t-text-dim)", opacity: 0.6 }} />
                  : <Icon icon="lucide:sparkles" width={9} style={{ color: "var(--t-text-dim)", opacity: 0.7 }} />
                }
              </button>
              {hasRole && !touch && <RoleBlurb name={role.name} />}
            </div>
          );
        })}
      {children}
    </div>
  );
}
