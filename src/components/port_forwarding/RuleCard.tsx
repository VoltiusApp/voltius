import { Icon } from "@iconify/react";
import type { PortForwardingRule, VaultOption } from "@/types";
import { BaseCard } from "@/components/shared/BaseCard";
import { CardActionButton } from "@/components/shared/CardActionButton";
import { type ContextMenuItem } from "@/components/shared/ContextMenu";
import { useUIContributions } from "@/hooks/useUIContributions";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import { getShortcutHint } from "@/stores/shortcutStore";

interface Props {
  rule: PortForwardingRule;
  isSelected?: boolean;
  isEditing?: boolean;
  isFocused?: boolean;
  canEdit?: boolean;
  isActive?: boolean;
  vaults?: VaultOption[];
  layout?: "grid" | "list";
  onSelect?: (id: string, event: React.MouseEvent<HTMLDivElement>) => void;
  onEdit: (rule: PortForwardingRule) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onActivate?: (rule: PortForwardingRule) => void;
  onMoveToVault?: (rule: PortForwardingRule, vaultId: string) => void;
  onCopyToVault?: (rule: PortForwardingRule, vaultId: string) => void;
  bulkContextMenuItems?: ContextMenuItem[];
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
}

export function RuleCard({
  rule, isSelected, isEditing, isFocused, canEdit = true, isActive,
  vaults = [], layout = "list",
  onSelect, onEdit, onDuplicate, onDelete, onActivate,
  onMoveToVault, onCopyToVault,
  bulkContextMenuItems, onDragStart, onDragEnd,
}: Props) {
  const isList = layout === "list";
  const contributions = useUIContributions("connection.contextMenu", rule);
  const isSynced = useSyncPrefsStore((s) => s.isObjectSynced(rule.id, "port-forwarding-rule"));

  const contextMenuItems: ContextMenuItem[] = [
    ...(canEdit ? [{ label: "Edit", icon: "lucide:pencil", onClick: () => onEdit(rule), shortcut: "E" }] : []),
    ...(onActivate ? [{ label: "Activate in session", icon: "lucide:plug-zap", onClick: () => onActivate(rule) }] : []),
    ...(canEdit ? [{ label: "Duplicate", icon: "lucide:copy", onClick: () => onDuplicate(rule.id), shortcut: "D" }] : []),
    ...contributions.map((a, i) => ({ ...a, divider: i === 0 })),
    ...vaultMenuItems(
      vaults,
      canEdit,
      (vId) => onMoveToVault?.(rule, vId),
      (vId) => onCopyToVault?.(rule, vId),
    ),
    {
      label: isSynced ? "Disable cloud sync" : "Enable cloud sync",
      icon: isSynced ? "lucide:cloud-off" : "lucide:cloud",
      onClick: () => useSyncPrefsStore.getState().toggleExcluded(rule.id),
      divider: true,
    },
    ...(canEdit ? [{ label: "Delete", icon: "lucide:trash-2", onClick: () => onDelete(rule.id), danger: true, shortcut: getShortcutHint("delete") }] : []),
  ];

  const portLabel = `${rule.local_port} → ${rule.remote_host}:${rule.remote_port}`;

  return (
    <BaseCard
      data-selectable-id={rule.id}
      isList={isList}
      isSelected={isSelected}
      isEditing={isEditing}
      isFocused={isFocused}
      isActive={isActive}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => onSelect?.(rule.id, e)}
      bulkContextMenuItems={bulkContextMenuItems}
      contextMenuItems={contextMenuItems}
    >
      <div className="flex items-center justify-center shrink-0 w-7 h-7 rounded-lg bg-[var(--t-bg-card-avatar)]">
        <Icon icon="lucide:network" width={15} />
      </div>

      {isList ? (
        <>
          <p className="font-medium-bold truncate w-40 shrink-0 text-[var(--t-text-bright)]">
            {rule.name}
          </p>
          <p className="text-xs truncate flex-1 text-[var(--t-text-secondary)] font-mono">
            {portLabel}
          </p>
          {rule.connection_ids.length > 0 && (
            <span
              className="text-[10px] px-1 py-0.5 rounded font-medium shrink-0 leading-none
                bg-amber-500/15 text-amber-400 hidden lg:inline"
              title={`Scoped to ${rule.connection_ids.length} connection${rule.connection_ids.length > 1 ? "s" : ""}`}
            >
              {rule.connection_ids.length}
            </span>
          )}
          {rule.description && (
            <p className="text-xs truncate text-[var(--t-text-muted)] hidden lg:block max-w-[12rem]">
              {rule.description}
            </p>
          )}
          {isActive && (
            <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="Active tunnel" />
          )}
          <div className="flex items-center gap-1 shrink-0">
            {canEdit && (
              <CardActionButton icon="lucide:pencil" title="Edit" onClick={() => onEdit(rule)} />
            )}
            {canEdit && (
              <CardActionButton icon="lucide:trash-2" title="Delete" onClick={() => onDelete(rule.id)} danger />
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <p className="font-medium truncate text-[var(--t-text-bright)]">{rule.name}</p>
          <p className="text-xs font-mono text-[var(--t-text-secondary)]">{portLabel}</p>
          {rule.description && (
            <p className="text-xs text-[var(--t-text-muted)] truncate">{rule.description}</p>
          )}
          {rule.connection_ids.length > 0 && (
            <span
              className="text-[10px] px-1 py-0.5 rounded font-medium w-fit leading-none
                bg-amber-500/15 text-amber-400"
              title={`Scoped to ${rule.connection_ids.length} connection${rule.connection_ids.length > 1 ? "s" : ""}`}
            >
              {rule.connection_ids.length} connection{rule.connection_ids.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}
    </BaseCard>
  );
}
