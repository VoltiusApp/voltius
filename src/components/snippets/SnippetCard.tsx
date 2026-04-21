import { Icon } from "@iconify/react";
import { BaseCard } from "@/components/shared/BaseCard";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import { getShortcutHint } from "@/stores/shortcutStore";
import type { Snippet, Folder, VaultOption } from "@/types";
import { useSnippetStore } from "@/stores/snippetStore";

interface Props {
  snippet: Snippet;
  folders: Folder[];
  isEditing?: boolean;
  isSelected?: boolean;
  isFocused?: boolean;
  canInject: boolean;
  dimmed?: boolean;
  onEdit: () => void;
  onSelect?: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onInsert: () => void;
  onExecute: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  bulkContextMenuItems?: ContextMenuItem[];
  vaults?: VaultOption[];
  canEdit?: boolean;
  onMoveToVault?: (vaultId: string) => void;
  onCopyToVault?: (vaultId: string) => void;
  syncEnabled?: boolean;
  onToggleSync?: () => void;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
}

export function SnippetCard({
  snippet,
  folders,
  isEditing,
  isSelected,
  isFocused,
  canInject,
  dimmed,
  onEdit,
  onSelect,
  onInsert,
  onExecute,
  onDuplicate,
  onDelete,
  onToggleFavorite,
  bulkContextMenuItems,
  vaults,
  canEdit,
  onMoveToVault,
  onCopyToVault,
  syncEnabled,
  onToggleSync,
  onDragStart,
  onDragEnd,
}: Props) {
  const pinSnippet = useSnippetStore((s) => s.pinSnippet);
  const folder = folders.find((f) => f.id === snippet.folder_id);

  const contextMenuItems: ContextMenuItem[] = [
    { label: "Edit",      icon: "lucide:pencil",  onClick: onEdit, shortcut: "E" },
    { label: "Duplicate", icon: "lucide:copy",    onClick: onDuplicate, shortcut: "D" },
    {
      label: snippet.favorite ? "Unpin" : "Pin",
      icon: snippet.favorite ? "lucide:pin-off" : "lucide:pin",
      onClick: () => pinSnippet(snippet.id, !snippet.favorite).catch(() => {}),
      divider: true as const,
    },
    ...(onToggleSync ? [{
      label: syncEnabled ? "Disable cloud sync" : "Enable cloud sync",
      icon: syncEnabled ? "lucide:cloud-off" : "lucide:cloud",
      onClick: onToggleSync,
    }] : []),
    ...vaultMenuItems(vaults, canEdit, onMoveToVault, onCopyToVault),
    { label: "Delete",    icon: "lucide:trash-2", onClick: onDelete, danger: true as const, divider: true as const, shortcut: getShortcutHint("delete") },
  ];

  return (
    <BaseCard
      isList
      isEditing={isEditing}
      isSelected={isSelected}
      isFocused={isFocused}
      data-selectable-id={snippet.id}
      data-card={snippet.id}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if (onSelect) onSelect(snippet.id, e);
        else onEdit();
      }}
      contextMenuItems={contextMenuItems}
      bulkContextMenuItems={bulkContextMenuItems}
      style={{ opacity: dimmed ? 0.45 : 1 }}
    >
      {/* Icon */}
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[var(--t-bg-elevated)] border border-[var(--t-border)]">
        <Icon icon="lucide:braces" width={14} className="text-[var(--t-accent)]" />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--t-text-primary)] truncate">
            {snippet.name}
          </span>
          {snippet.favorite && (
            <Icon icon="lucide:star" width={11} className="shrink-0 text-[var(--t-accent)]" />
          )}
          {folder && (
            <span className="flex items-center gap-1 text-xs text-[var(--t-text-dim)] shrink-0">
              <Icon icon="lucide:folder" width={10} />
              {folder.name}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs font-mono text-[var(--t-text-muted)] truncate">
          {snippet.content}
        </p>
        {snippet.tags.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {snippet.tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 text-xs rounded-md bg-[var(--t-bg-elevated)] text-[var(--t-text-dim)] border border-[var(--t-border)]"
              >
                {tag}
              </span>
            ))}
            {snippet.tags.length > 5 && (
              <span className="text-xs text-[var(--t-text-dim)]">+{snippet.tags.length - 5}</span>
            )}
          </div>
        )}
      </div>

      {/* Actions — visible on hover via group class in BaseCard */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          title={snippet.favorite ? "Unstar" : "Star"}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          className="p-1.5 hidden group-hover:flex rounded-lg transition-colors"
          style={{ color: snippet.favorite ? "var(--t-accent)" : "var(--t-text-secondary)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-accent)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = snippet.favorite ? "var(--t-accent)" : "var(--t-text-secondary)")}
        >
          <Icon icon={snippet.favorite ? "lucide:star" : "lucide:star"} width={16} />
        </button>

        {canInject && (
          <>
            <button
              title="Insert"
              onClick={(e) => { e.stopPropagation(); onInsert(); }}
              className="p-1.5 hidden group-hover:flex rounded-lg transition-colors text-[var(--t-text-secondary)]"
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-secondary)")}
            >
              <Icon icon="lucide:arrow-down-to-line" width={16} />
            </button>
            <button
              title="Execute"
              onClick={(e) => { e.stopPropagation(); onExecute(); }}
              className="p-1.5 hidden group-hover:flex rounded-lg transition-colors text-[var(--t-text-secondary)]"
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-secondary)")}
            >
              <Icon icon="lucide:play" width={16} />
            </button>
          </>
        )}
      </div>
    </BaseCard>
  );
}
