import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { TeamMember, TeamRole } from "@/stores/teamStore";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import type { LayoutMode } from "@/components/shared/ToolbarViewControls";
import { PresenceAvatar } from "@/components/shared/PresenceAvatar";
import { BaseCard } from "@/components/shared/BaseCard";
import { CardActionButton } from "@/components/shared/CardActionButton";
import { RoleBadges } from "@/components/members/roleBadges";
import { memberAvatarLabel, memberLabel, secondaryHandle } from "@/services/memberLabel";

export interface MemberCardProps {
  member: TeamMember;
  roles: TeamRole[];
  isMe: boolean;
  isOwner: boolean;
  isSelected: boolean;
  isFocused: boolean;
  isEditing: boolean;
  layoutMode: LayoutMode;
  canManage?: boolean;
  editable: boolean;
  onAddRole?: () => void;
  onSelect: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onOpen: () => void;
  contextMenuItems: ContextMenuItem[];
  bulkContextMenuItems?: ContextMenuItem[];
}

export function memberOpenAction(t: TFunction, editable: boolean) {
  return editable
    ? { icon: "lucide:pencil", label: t("common.action.edit") }
    : { icon: "lucide:panel-right-open", label: t("members.contextMenu.viewDetails") };
}

export function MemberAvatar({ member, size }: { member: TeamMember; size: number }) {
  return <PresenceAvatar handle={memberAvatarLabel(member)} size={size} online={member.is_online} animate />;
}

export function MemberCard({
  member, roles, isMe, isOwner, isSelected, isFocused, isEditing, layoutMode,
  canManage, editable, onAddRole,
  onSelect, onOpen, contextMenuItems, bulkContextMenuItems,
}: MemberCardProps) {
  const { t } = useTranslation();
  const openAction = memberOpenAction(t, editable);
  const openButton = (reveal: boolean) => (
    <CardActionButton
      icon={openAction.icon}
      title={openAction.label}
      reveal={reveal}
      width={reveal ? 18 : 14}
      onClick={onOpen}
    />
  );
  if (layoutMode === "grid") {
    return (
      <BaseCard
        data-selectable-id={member.user_id}
        isSelected={isSelected}
        isFocused={isFocused}
        isEditing={isEditing}
        isList={false}
        onClick={(e) => onSelect(member.user_id, e)}
        onDoubleClick={onOpen}
        contextMenuItems={contextMenuItems}
        bulkContextMenuItems={bulkContextMenuItems}
        className="flex-col items-center text-center gap-2 py-4"
      >
        <div className="absolute top-1.5 right-1.5">{openButton(false)}</div>
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
            <p className="text-xs font-medium truncate text-(--t-text-bright) max-w-[120px]">{memberLabel(member)}</p>
            {isMe && (
              <span className="text-[9px] px-1 py-0.5 rounded-sm shrink-0" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>{t("members.youBadge")}</span>
            )}
          </div>
          {secondaryHandle(member) && (
            <p className="text-[10px] truncate max-w-[120px] text-(--t-text-secondary)">{secondaryHandle(member)}</p>
          )}
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
      isEditing={isEditing}
      isList
      onClick={(e) => onSelect(member.user_id, e)}
      onDoubleClick={onOpen}
      contextMenuItems={contextMenuItems}
      bulkContextMenuItems={bulkContextMenuItems}
    >
      <MemberAvatar member={member} size={32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate text-(--t-text-bright)">{memberLabel(member)}</p>
          {isOwner && <Icon icon="lucide:crown" width={11} style={{ color: "#a78bfa", flexShrink: 0 }} />}
          {isMe && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-sm shrink-0" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>{t("members.youBadge")}</span>
          )}
        </div>
        {secondaryHandle(member) && (
          <p className="text-[11px] truncate text-(--t-text-secondary)">{secondaryHandle(member)}</p>
        )}
      </div>
      <RoleBadges member={member} roles={roles} canManage={canManage} onAddRole={onAddRole} />
      {openButton(true)}
    </BaseCard>
  );
}
