import { useState } from "react";
import { Icon } from "@iconify/react";
import { BaseCard } from "@/components/shared/BaseCard";
import { TagBadge } from "@/components/shared/TagBadge";
import { SessionPickerPanel } from "@/components/shared/SessionPickerPanel";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import { getShortcutHint } from "@/stores/shortcutStore";
import type { Snippet, Folder, VaultOption } from "@/types";
import { useSnippetStore } from "@/stores/snippetStore";
import { useTeamStore } from "@/stores/teamStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";

interface Props {
  snippet: Snippet;
  folders: Folder[];
  isEditing?: boolean;
  isSelected?: boolean;
  isFocused?: boolean;
  dimmed?: boolean;
  layout?: "grid" | "list";
  onEdit: () => void;
  onSelect?: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onInsert: (sessionId: string) => void;
  onExecute: (sessionId: string) => void;
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
  dimmed,
  layout = "list",
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
  const isList = layout === "list";
  const pinSnippet = useSnippetStore((s) => s.pinSnippet);
  const pinSnippetForTeam = useSnippetStore((s) => s.pinSnippetForTeam);
  const folder = folders.find((f) => f.id === snippet.folder_id);
  const [panelMode, setPanelMode] = useState<"insert" | "execute" | null>(null);
  const effPinned = useEffectivePinned(snippet, "snippet");
  const pinSource = useEffectivePinSource(snippet, "snippet");
  const isTeamVault = useTeamStore((s) => s.teams.some((t) => t.id === snippet.vault_id));
  const handlePinClick = () => {
    if (!isTeamVault) {
      pinSnippet(snippet.id, !effPinned).catch(() => {});
    } else {
      pinSnippet(snippet.id, nextPersonalPinValue(pinSource)).catch(() => {});
    }
  };
  const pinColor =
    pinSource === "personal" || pinSource === "team+personal"
      ? "var(--t-accent)"
      : pinSource === "team"
      ? "var(--t-text-secondary)"
      : "var(--t-text-dim)";
  const pinAlwaysVisible = pinSource !== "none" && pinSource !== "team-hidden";

  const contextMenuItems: ContextMenuItem[] = [
    { label: "Edit",      icon: "lucide:pencil",  onClick: onEdit, shortcut: "E" },
    { label: "Duplicate", icon: "lucide:copy",    onClick: onDuplicate, shortcut: "D" },
    {
      label: isTeamVault
        ? (pinSource === "personal" || pinSource === "team+personal")
          ? "Unpin for me"
          : pinSource === "team-hidden"
          ? "Show in my view"
          : pinSource === "team"
          ? "Hide for me"
          : "Pin for me"
        : effPinned ? "Unpin" : "Pin",
      icon: (pinSource === "personal" || pinSource === "team+personal" || (!isTeamVault && effPinned))
        ? "lucide:pin-off"
        : "lucide:pin",
      onClick: handlePinClick,
      divider: true as const,
    },
    ...(canEdit && isTeamVault ? [{
      label: snippet.favorite ? "Unpin for team" : "Pin for team",
      icon: "lucide:users",
      onClick: () => pinSnippetForTeam(snippet.id, !snippet.favorite).catch(() => {}),
    }] : []),
    ...(onToggleSync ? [{
      label: syncEnabled ? "Disable cloud sync" : "Enable cloud sync",
      icon: syncEnabled ? "lucide:cloud-off" : "lucide:cloud",
      onClick: onToggleSync,
    }] : []),
    ...vaultMenuItems(vaults, canEdit, onMoveToVault, onCopyToVault),
    { label: "Delete", icon: "lucide:trash-2", onClick: onDelete, danger: true as const, divider: true as const, shortcut: getShortcutHint("delete") },
  ];

  if (!isList) {
    return (
      <>
        <BaseCard
          isList={false}
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
          {/* self-start overrides BaseCard's items-center so content is top-left aligned */}
          <div className="flex-1 min-w-0 self-start flex flex-col gap-2.5">
            {/* Header: avatar + name/fav/tags + description */}
            <div className="flex items-start gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-[var(--t-bg-card-avatar)]">
                <Icon icon="lucide:braces" width={14} />
              </div>
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                {/* Name + favorite (pin position) + tags */}
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm font-bold truncate text-[var(--t-text-bright)] flex-1 min-w-0">
                    {snippet.name}
                  </p>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
                    className={`shrink-0 flex items-center transition-colors ${pinAlwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100 hover:text-[var(--t-text-bright)]"}`}
                    style={{ color: pinColor }}
                    title={effPinned ? "Unstar" : "Star"}
                  >
                    <Icon icon="lucide:star" width={14} />
                  </button>
                  {snippet.tags.slice(0, 2).map((tag) => (
                    <TagBadge key={tag} tag={tag} className="rounded-md shrink-0 py-0 text-[10px]" />
                  ))}
                  {snippet.tags.length > 2 && (
                    <span className="text-[10px] text-[var(--t-text-dim)] shrink-0">+{snippet.tags.length - 2}</span>
                  )}
                </div>
                {/* Description */}
                {snippet.description && (
                  <p className="text-xs text-[var(--t-text-muted)] truncate leading-tight">
                    {snippet.description}
                  </p>
                )}
              </div>
            </div>

            {/* Terminal content preview */}
            <div
              className="rounded-md overflow-hidden w-full"
              style={{ background: "var(--t-bg-terminal)" }}
            >
              <div className="flex items-center gap-1 px-2.5 pt-2 pb-1">
                <span className="w-2 h-2 rounded-full bg-[#ff5f56]" />
                <span className="w-2 h-2 rounded-full bg-[#ffbd2e]" />
                <span className="w-2 h-2 rounded-full bg-[#27c93f]" />
              </div>
              <p
                className="px-2.5 pb-2.5 text-[11px] leading-relaxed break-all"
                style={{
                  fontFamily: "var(--t-terminal-font-family)",
                  color: snippet.content ? "var(--t-terminal-foreground)" : "var(--t-text-dim)",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {`> ${snippet.content || "No content"}`}
              </p>
            </div>

            {/* Actions row */}
            <div className="flex items-center justify-between -mt-0.5">
              <div className="flex items-center gap-1 text-xs text-[var(--t-text-dim)]">
                {folder && (
                  <>
                    <Icon icon="lucide:folder" width={10} />
                    <span className="truncate max-w-[80px]">{folder.name}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  title="Insert"
                  onClick={(e) => { e.stopPropagation(); setPanelMode("insert"); }}
                  className="p-1.5 rounded-lg transition-colors text-[var(--t-text-secondary)]"
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-bright)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-secondary)")}
                >
                  <Icon icon="lucide:skip-forward" width={15} />
                </button>
                <button
                  title="Execute"
                  onClick={(e) => { e.stopPropagation(); setPanelMode("execute"); }}
                  className="p-1.5 rounded-lg transition-colors text-[var(--t-text-secondary)]"
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-bright)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-secondary)")}
                >
                  <Icon icon="lucide:play" width={15} />
                </button>
              </div>
            </div>
          </div>
        </BaseCard>

        {panelMode && (
          <SessionPickerPanel
            mode={panelMode}
            onConfirm={(sessionIds) => {
              const action = panelMode === "insert" ? onInsert : onExecute;
              sessionIds.forEach((id) => action(id));
            }}
            onClose={() => setPanelMode(null)}
          />
        )}
      </>
    );
  }

  return (
    <>
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
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[var(--t-bg-card-avatar)]">
          <Icon icon="lucide:braces" width={14} />
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-[var(--t-text-bright)] truncate flex-1 min-w-0">
              {snippet.name}
            </span>
            {effPinned && (
              <Icon icon="lucide:star" width={11} className="shrink-0" style={{ color: pinColor }} />
            )}
            {folder && (
              <span className="flex items-center gap-1 text-xs text-[var(--t-text-dim)] shrink-0">
                <Icon icon="lucide:folder" width={10} />
                {folder.name}
              </span>
            )}
          </div>
          {snippet.description ? (
            <p className="mt-0.5 text-xs text-[var(--t-text-muted)] truncate">{snippet.description}</p>
          ) : (
            <p className="mt-0.5 text-xs font-mono text-[var(--t-text-muted)] truncate">{snippet.content}</p>
          )}
          {snippet.tags.length > 0 && (
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {snippet.tags.slice(0, 5).map((tag) => <TagBadge key={tag} tag={tag} className="rounded-md" />)}
              {snippet.tags.length > 5 && (
                <span className="text-xs text-[var(--t-text-dim)]">+{snippet.tags.length - 5}</span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            title={effPinned ? "Unstar" : "Star"}
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
            className={`p-1.5 rounded-lg transition-colors ${pinAlwaysVisible ? "flex" : "hidden group-hover:flex"}`}
            style={{ color: pinColor }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = pinColor)}
          >
            <Icon icon="lucide:star" width={16} />
          </button>

          <button
            title="Insert"
            onClick={(e) => { e.stopPropagation(); setPanelMode("insert"); }}
            className="p-1.5 flex rounded-lg transition-colors text-[var(--t-text-secondary)]"
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-secondary)")}
          >
            <Icon icon="lucide:skip-forward" width={16} />
          </button>
          <button
            title="Execute"
            onClick={(e) => { e.stopPropagation(); setPanelMode("execute"); }}
            className="p-1.5 flex rounded-lg transition-colors text-[var(--t-text-secondary)]"
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-secondary)")}
          >
            <Icon icon="lucide:play" width={16} />
          </button>
        </div>
      </BaseCard>

      {panelMode && (
        <SessionPickerPanel
          mode={panelMode}
          onConfirm={(sessionIds) => {
            const action = panelMode === "insert" ? onInsert : onExecute;
            sessionIds.forEach((id) => action(id));
          }}
          onClose={() => setPanelMode(null)}
        />
      )}
    </>
  );
}
