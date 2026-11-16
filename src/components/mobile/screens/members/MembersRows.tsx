import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TeamMember, TeamRole } from "@/stores/teamStore";
import type { PendingInvitation } from "@/services/teamService";
import { MiniAvatar } from "@/components/shared/AvatarStack";
import { MemberAvatar, YouBadge } from "@/components/members/cards/MemberCard";
import { inviteExpiry } from "@/components/members/cards/PendingInviteCard";
import { RoleBadges } from "@/components/members/roleBadges";
import { inviteLabel, memberLabel, secondaryHandle } from "@/services/memberLabel";
import MobileListRow from "../../MobileListRow";

export function MemberRow({ member, roles, isMe, selecting, selected, selectDisabledReason, onTap, onLong }: {
  member: TeamMember;
  roles: TeamRole[];
  isMe: boolean;
  selecting: boolean;
  selected: boolean;
  selectDisabledReason: string | null;
  onTap: () => void;
  onLong: () => void;
}) {
  const handle = secondaryHandle(member);
  return (
    <MobileListRow
      attr="mobile-member"
      id={member.user_id}
      leading={<MemberAvatar member={member} size={40} />}
      title={memberLabel(member)}
      subtitle={
        <span className="flex items-center gap-1.5 min-w-0">
          {handle && <span className="truncate">{handle}</span>}
          <RoleBadges member={member} roles={roles} />
        </span>
      }
      trailing={isMe && <YouBadge />}
      selecting={selecting}
      selected={selected}
      selectDisabledReason={selectDisabledReason}
      onTap={onTap}
      onLong={onLong}
    />
  );
}

export function InviteRow({ inv, onTap }: { inv: PendingInvitation; onTap: () => void }) {
  const { t } = useTranslation();
  const name = inviteLabel(inv);
  const { isExpired, label } = inviteExpiry(t, inv);
  return (
    <MobileListRow
      attr="mobile-invite"
      id={inv.id}
      leading={<MiniAvatar name={name} size={40} />}
      title={name}
      subtitle={
        <>
          {inv.member_name && <>{inv.display_name} · </>}
          <span style={{ color: isExpired ? "var(--t-status-error)" : undefined }}>{label}</span>
        </>
      }
      onTap={onTap}
    />
  );
}

export function NavRow({ attr = "members-nav", id, icon, label, subtitle, disabledReason, onTap }: {
  attr?: string;
  id: string;
  icon: string;
  label: ReactNode;
  subtitle?: ReactNode;
  disabledReason?: string;
  onTap: () => void;
}) {
  return (
    <MobileListRow
      attr={attr}
      id={id}
      leading={<span className="w-10 h-10 shrink-0 flex items-center justify-center text-(--t-text-dim)"><Icon icon={icon} width={24} /></span>}
      title={label}
      subtitle={subtitle}
      trailing={<Icon icon="lucide:chevron-right" width={20} className="shrink-0 text-(--t-text-dim)" />}
      disabled={!!disabledReason}
      disabledReason={disabledReason}
      onTap={onTap}
    />
  );
}
