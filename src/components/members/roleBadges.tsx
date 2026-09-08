import { Icon } from "@iconify/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TeamMember, TeamRole } from "@/stores/teamStore";
import { avatarColor } from "@/components/shared/AvatarStack";
import { ROLE_META, RolePermissionTooltip } from "@/components/members/roleChips";

export function RoleChip({ role }: { role: TeamRole }) {
  const [showTip, setShowTip] = useState(false);
  const meta = ROLE_META[role.name];
  const color = role.color ?? meta?.color ?? avatarColor(role.name);
  const bg = meta?.bg ?? `${color}1a`;

  return (
    <span className="relative inline-flex items-center" style={{ verticalAlign: "middle" }}>
      <span
        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full capitalize shrink-0 cursor-default"
        style={{ color, background: bg }}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
      >
        {role.is_builtin
          ? <Icon icon="lucide:lock" width={8} style={{ opacity: 0.6 }} />
          : <Icon icon="lucide:sparkles" width={8} style={{ opacity: 0.7 }} />
        }
        {role.name}
      </span>
      {showTip && <RolePermissionTooltip role={role} color={color} />}
    </span>
  );
}

export function RoleBadges({
  member, roles, canManage, onAddRole,
}: {
  member: TeamMember;
  roles: TeamRole[];
  canManage?: boolean;
  onAddRole?: () => void;
}) {
  const { t } = useTranslation();
  const memberRoles = member.role_ids
    .map((rid) => roles.find((r) => r.id === rid))
    .filter(Boolean) as TeamRole[];
  memberRoles.sort((a, b) => a.position - b.position);
  if (memberRoles.length === 0) {
    if (canManage && onAddRole) {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); onAddRole(); }}
          className="text-[10px] transition-colors"
          style={{ color: "var(--t-text-dim)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-accent)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
        >
          {t("members.noRoleAddPrompt")}
        </button>
      );
    }
    return <span className="text-[10px] text-(--t-text-dim)">{t("members.noRole")}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {memberRoles.map((r) => <RoleChip key={r.id} role={r} />)}
    </div>
  );
}
