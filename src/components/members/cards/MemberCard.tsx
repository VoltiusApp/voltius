import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TeamMember, TeamRole } from "@/stores/teamStore";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import type { LayoutMode } from "@/components/shared/ToolbarViewControls";
import { PresenceAvatar } from "@/components/shared/PresenceAvatar";
import { BaseCard } from "@/components/shared/BaseCard";
import { RoleBadges } from "@/components/members/roleBadges";

export interface MemberCardProps {
  member: TeamMember;
  roles: TeamRole[];
  isMe: boolean;
  isOwner: boolean;
  isSelected: boolean;
  isFocused: boolean;
  layoutMode: LayoutMode;
  canManage?: boolean;
  onAddRole?: () => void;
  onSelect: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
  contextMenuItems: ContextMenuItem[];
  bulkContextMenuItems?: ContextMenuItem[];
}

export function MemberAvatar({ member, size }: { member: TeamMember; size: number }) {
  return <PresenceAvatar handle={member.handle} size={size} online={member.is_online} animate />;
}

export function MemberCard({
  member, roles, isMe, isOwner, isSelected, isFocused, layoutMode,
  canManage, onAddRole,
  onSelect, onDoubleClick, contextMenuItems, bulkContextMenuItems,
}: MemberCardProps) {
  const { t } = useTranslation();
  if (layoutMode === "grid") {
    return (
      <BaseCard
        data-selectable-id={member.user_id}
        isSelected={isSelected}
        isFocused={isFocused}
        isList={false}
        onClick={(e) => onSelect(member.user_id, e)}
        onDoubleClick={onDoubleClick}
        contextMenuItems={contextMenuItems}
        bulkContextMenuItems={bulkContextMenuItems}
        className="flex-col items-center text-center gap-2 py-4"
      >
        <div className="relative">
          <MemberAvatar member={member} size={40} />
          {isOwner && (
            <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full" style={{ background: "rgba(167,139,250,0.2)", border: "1px solid rgba(167,139,250,0.35)" }}>
              <Icon icon="lucide:crown" width={8} style={{ color: "#a78bfa" }} />
            </span>
          )}
        </div>
        <div className="w-full min-w-0 flex flex-col items-center gap-1">
          <div className="flex items-center gap-1 justify-center">
            <p className="text-xs font-medium truncate text-(--t-text-bright) max-w-[120px]">{member.handle}</p>
            {isMe && (
              <span className="text-[9px] px-1 py-0.5 rounded-sm shrink-0" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>{t("members.youBadge")}</span>
            )}
          </div>
          <RoleBadges member={member} roles={roles} canManage={canManage} onAddRole={onAddRole} />
        </div>
      </BaseCard>
    );
  }

  return (
    <BaseCard
      data-selectable-id={member.user_id}
      isSelected={isSelected}
      isFocused={isFocused}
      isList
      onClick={(e) => onSelect(member.user_id, e)}
      onDoubleClick={onDoubleClick}
      contextMenuItems={contextMenuItems}
      bulkContextMenuItems={bulkContextMenuItems}
    >
      <MemberAvatar member={member} size={32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate text-(--t-text-bright)">{member.handle}</p>
          {isOwner && <Icon icon="lucide:crown" width={11} style={{ color: "#a78bfa", flexShrink: 0 }} />}
          {isMe && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-sm shrink-0" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>{t("members.youBadge")}</span>
          )}
        </div>
      </div>
      <RoleBadges member={member} roles={roles} canManage={canManage} onAddRole={onAddRole} />
    </BaseCard>
  );
}
