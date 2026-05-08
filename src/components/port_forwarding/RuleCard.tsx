import { Icon } from "@iconify/react";
import type { PortForwardingRule, VaultOption } from "@/types";
import { formatRuleLabel } from "@/utils/tunnelFormat";
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
  status?: "inactive" | "active" | "error";
  statusLabel?: string;
  isBusy?: boolean;
  webUrl?: string | null;
  onSelect?: (id: string, event: React.MouseEvent<HTMLDivElement>) => void;
  onEdit: (rule: PortForwardingRule) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onStart?: (rule: PortForwardingRule) => void;
  onStop?: (rule: PortForwardingRule) => void;
  onOpenWeb?: (url: string) => void;
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
  status = isActive ? "active" : "inactive", statusLabel, isBusy = false, webUrl,
  onSelect, onEdit, onDuplicate, onDelete, onActivate,
  onStart, onStop, onOpenWeb,
  onMoveToVault, onCopyToVault,
  bulkContextMenuItems, onDragStart, onDragEnd,
}: Props) {
  const isList = layout === "list";
  const contributions = useUIContributions("connection.contextMenu", rule);
  const isSynced = useSyncPrefsStore((s) => s.isObjectSynced(rule.id, "port-forwarding-rule"));

  const contextMenuItems: ContextMenuItem[] = [
    ...(canEdit ? [{ label: "Edit", icon: "lucide:pencil", onClick: () => onEdit(rule), shortcut: "E" }] : []),
    ...(status === "active" && onStop ? [{ label: "Stop", icon: "lucide:square", onClick: () => onStop(rule) }] : []),
    ...(status !== "active" && onStart ? [{ label: "Start", icon: "lucide:play", onClick: () => onStart(rule) }] : []),
    ...(webUrl && onOpenWeb ? [{ label: "Open web link", icon: "lucide:globe", onClick: () => onOpenWeb(webUrl) }] : []),
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

  const portLabel = formatRuleLabel(rule);
  const tunnelType = rule.tunnel_type ?? "local";
  const typeBadgeClass = tunnelType === "remote"
    ? "bg-orange-500/15 text-orange-400 border-orange-500/20"
    : tunnelType === "dynamic"
    ? "bg-purple-500/20 text-purple-400 border-purple-500/20"
    : "bg-blue-500/15 text-blue-400 border-blue-500/20";
  const typeBadge = (
    <span className={`shrink-0 px-1.5 py-0.5 rounded-md text-[11px] font-semibold border ${typeBadgeClass}`}>
      {tunnelType === "dynamic" ? "SOCKS5" : tunnelType.toUpperCase()}
    </span>
  );
  const statusColor = status === "active" ? "bg-green-500" : status === "error" ? "bg-red-500" : "bg-[var(--t-text-dim)] opacity-40";
  const effectiveStatusLabel = statusLabel ?? (status === "active" ? "Active" : status === "error" ? "Error" : "Stopped");
  const actionIcon = isBusy ? "lucide:loader-circle" : status === "active" ? "lucide:square" : "lucide:play";
  const actionTitle = status === "active" ? "Stop forwarding" : "Start forwarding";
  const handleToggle = () => {
    if (status === "active") onStop?.(rule);
    else onStart?.(rule);
  };
  const actionButtons = (
    <div className="flex items-center gap-1 shrink-0">
      {canEdit && <CardActionButton icon="lucide:pencil" title="Edit" onClick={() => onEdit(rule)} />}
      <CardActionButton icon={actionIcon} title={actionTitle} onClick={handleToggle} />
      {webUrl && onOpenWeb && <CardActionButton icon="lucide:globe" title={`Open ${webUrl}`} onClick={() => onOpenWeb(webUrl)} />}
      {canEdit && <CardActionButton icon="lucide:trash-2" title="Delete" onClick={() => onDelete(rule.id)} danger />}
    </div>
  );

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
      {isList ? (
        <>
          <div className="relative shrink-0">
            <div className="flex items-center justify-center shrink-0 w-7 h-7 rounded-lg bg-[var(--t-bg-card-avatar)] text-[var(--t-text-secondary)]">
              <Icon icon="lucide:network" width={15} />
            </div>
            <span className={`absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[var(--t-bg-card)] ${statusColor}`} title={effectiveStatusLabel} />
          </div>
          <p className="font-medium-bold truncate w-48 shrink-0 text-[var(--t-text-bright)]">
            {rule.name}
          </p>
          {typeBadge}
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
          <span className="text-xs text-[var(--t-text-dim)] shrink-0 hidden md:inline">{effectiveStatusLabel}</span>
          {actionButtons}
        </>
      ) : (
        <div className="flex-1 min-w-0 self-start flex flex-col gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <div className="relative shrink-0">
              <div className="flex items-center justify-center w-[30px] h-[30px] rounded-lg bg-[var(--t-bg-card-avatar)] text-[var(--t-text-secondary)]">
                <Icon icon="lucide:network" width={16} />
              </div>
              <span className={`absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[var(--t-bg-card)] ${statusColor}`} title={effectiveStatusLabel} />
            </div>
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-sm font-bold truncate text-[var(--t-text-bright)]">{rule.name}</p>
                {typeBadge}
                <span className="ml-auto text-xs font-medium text-[var(--t-text-dim)] shrink-0">{effectiveStatusLabel}</span>
              </div>
              <p className="text-xs font-mono text-[var(--t-text-secondary)] truncate">{portLabel}</p>
            </div>
          </div>
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
          <div className="flex items-center gap-3">
            {canEdit && (
              <button onClick={(e) => { e.stopPropagation(); onDelete(rule.id); }} className="text-[var(--t-text-dim)] hover:text-[var(--t-status-error)] transition-colors flex items-center" title="Delete">
                <Icon icon="lucide:trash-2" width={18} />
              </button>
            )}
            {canEdit && (
              <button onClick={(e) => { e.stopPropagation(); onEdit(rule); }} className="text-[var(--t-text-dim)] hover:text-[var(--t-text-bright)] transition-colors flex items-center" title="Edit">
                <Icon icon="lucide:square-pen" width={18} />
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); handleToggle(); }} className="text-[var(--t-text-dim)] hover:text-[var(--t-text-bright)] transition-colors flex items-center" title={actionTitle}>
              <Icon icon={actionIcon} width={18} className={isBusy ? "animate-spin" : undefined} />
            </button>
            {webUrl && onOpenWeb && (
              <button onClick={(e) => { e.stopPropagation(); onOpenWeb(webUrl); }} className="text-[var(--t-text-dim)] hover:text-[var(--t-text-bright)] transition-colors flex items-center" title={`Open ${webUrl}`}>
                <Icon icon="lucide:globe" width={18} />
              </button>
            )}
          </div>
        </div>
      )}
    </BaseCard>
  );
}
