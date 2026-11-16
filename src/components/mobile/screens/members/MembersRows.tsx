import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TeamMember, TeamRole } from "@/stores/teamStore";
import type { PendingInvitation } from "@/services/teamService";
import { MiniAvatar } from "@/components/shared/AvatarStack";
import { MemberAvatar } from "@/components/members/cards/MemberCard";
import { OwnerChip } from "@/components/members/cards/SelfCard";
import { inviteExpiry } from "@/components/members/cards/PendingInviteCard";
import { OverrideMarker, RoleBadges, RoleChip, sortedMemberRoles } from "@/components/members/roleBadges";
import { roleLabel } from "@/components/members/roleChips";
import { OverflowList } from "@/components/shared/OverflowTagList";
import { inviteLabel, memberLabel, secondaryHandle } from "@/services/memberLabel";
import MobileListRow from "../../MobileListRow";

const MORE_CHIP = "shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-(--t-bg-elevated) text-(--t-text-dim)";

function RoleChipStrip({ member, roles }: { member: TeamMember; roles: TeamRole[] }) {
  const { t } = useTranslation();
  const list = sortedMemberRoles(member, roles);
  if (list.length === 0) return <RoleBadges member={member} roles={roles} />;
  return (
    <OverflowList
      items={list.map((r) => ({ key: r.id, label: roleLabel(t, r.name), node: <RoleChip role={r} /> }))}
      moreClassName={MORE_CHIP}
      trailing={<OverrideMarker member={member} />}
    />
  );
}

export function MemberRow({ member, roles, selecting, selected, selectDisabledReason, onTap, onLong }: {
  member: TeamMember;
  roles: TeamRole[];
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
      title={
        <>
          <span className="truncate">{memberLabel(member)}</span>
          {handle && <span className="min-w-0 shrink-[3] truncate text-sm font-normal text-(--t-text-dim)">{handle}</span>}
        </>
      }
      subtitle={<RoleChipStrip member={member} roles={roles} />}
      selecting={selecting}
      selected={selected}
      selectDisabledReason={selectDisabledReason}
      onTap={onTap}
      onLong={onLong}
    />
  );
}

export function SelfRow({ userId, handle }: { userId: string; handle: string | null }) {
  const { t } = useTranslation();
  return (
    <MobileListRow
      attr="mobile-self"
      id={userId}
      leading={<MiniAvatar name={handle || "?"} size={40} />}
      title={handle || t("members.you")}
      subtitle={<OwnerChip />}
      onTap={() => {}}
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
