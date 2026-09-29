import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { GLASS_BG, GLASS_BG_HOVER, GLASS_SHADOW, GLASS_SHADOW_HOVER } from "@/components/shared/BaseCard";
import { CardActionButton } from "@/components/shared/CardActionButton";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { clipboardMenuItems } from "@/utils/clipboardMenuItems";
import { buildFolderMenuItems } from "@/utils/folderMenuItems";
import { useFolderPin } from "./useFolderPin";
import type { Folder, VaultOption } from "@/types";

interface FolderCardProps {
  folder: Folder;
  itemCount: number;
  layout: "grid" | "list";
  isSelected?: boolean;
  isFocused?: boolean;
  isDragOver?: boolean;
  /** Faded while the folder sits on the clipboard as a pending cut. */
  dimmed?: boolean;
  onClick: () => void;
  onRename: (folder: Folder, newName: string) => void;
  onDelete: (folder: Folder) => void;
  onSelect?: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onEdit?: () => void;
  onExport?: () => void;
  onShare?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  vaults?: VaultOption[];
  canEdit?: boolean;
  onMoveToVault?: (vaultId: string) => void;
  onCopyToVault?: (vaultId: string) => void;
  bulkContextMenuItems?: ContextMenuItem[];
  "data-drop-folder"?: string;
}

export function FolderCard({
  folder,
  itemCount,
  layout,
  isSelected,
  isFocused,
  isDragOver,
  dimmed,
  onClick,
  onRename,
  onDelete,
  onSelect,
  onEdit,
  onExport,
  onShare,
  onPointerDown,
  vaults,
  canEdit,
  onMoveToVault,
  onCopyToVault,
  bulkContextMenuItems,
  "data-drop-folder": dataDropFolder,
}: FolderCardProps) {
  const { t } = useTranslation();
  const isList = layout === "list";
  const avatarSize = isList ? 28 : 48;
  const iconSize = isList ? 14 : 22;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const { pos: ctxPos, open: openCtx, close: closeCtx } = useContextMenu();
  const isSynced = useSyncPrefsStore((s) => s.isObjectSynced(folder.id, "folder"));
  const toggleSync = useSyncPrefsStore((s) => s.toggleExcluded);
  const { effPinned, pinIcon, pinColor, pinAlwaysVisible, togglePin, pinItem, pinTeamItem } = useFolderPin(folder, canEdit);
  const activeMenuItems = isSelected && bulkContextMenuItems?.length ? bulkContextMenuItems : undefined;

  const handleRenameCommit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== folder.name) onRename(folder, trimmed);
    setRenaming(false);
  };

  const dragBorder = isDragOver
    ? "2px dashed var(--t-accent)"
    : isSelected
    ? "2px solid var(--t-tab-active-text)"
    : "2px solid transparent";

  const focusBoxShadow = isFocused && !isSelected
    ? "inset 0 0 0 2px var(--t-accent)"
    : undefined;

  // Glossy depth in grid (objects-you-manipulate role); list stays calm/flat.
  const glossy = !isList;
  const restBg = isDragOver
    ? "color-mix(in srgb, var(--t-accent) 8%, var(--t-bg-card))"
    : glossy
    ? GLASS_BG
    : "var(--t-bg-card)";
  const hoverBg = glossy ? GLASS_BG_HOVER : "var(--t-bg-card-hover)";
  const restShadow =
    [focusBoxShadow, glossy && !isDragOver ? GLASS_SHADOW : null].filter(Boolean).join(", ") || undefined;
  const hoverShadow = glossy
    ? GLASS_SHADOW_HOVER
    : "inset 0 0 0 1px var(--t-card-ring), var(--t-card-shadow)";

  return (
    <>
      <div
        data-folder-card="true"
        data-selectable-id={folder.id}
        data-drop-folder={dataDropFolder}
        className={`group flex items-center px-4 cursor-pointer transition-all duration-150 ${isList ? "gap-2.5 py-2.5 rounded-xl" : "gap-4 py-4 rounded-2xl"} ${dimmed ? "opacity-50" : ""}`}
        style={{
          background: restBg,
          border: dragBorder,
          boxShadow: restShadow,
          ...(glossy
            ? { backdropFilter: "blur(12px) saturate(1.5)", WebkitBackdropFilter: "blur(12px) saturate(1.5)" }
            : {}),
        }}
        onClick={(e) => { e.stopPropagation(); if (!renaming) onClick(); }}
        onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); onSelect?.(folder.id, e); openCtx(e); }}
        onPointerDown={onPointerDown}
        onMouseEnter={(e) => {
          if (isDragOver) return;
          e.currentTarget.style.background = hoverBg;
          if (!isSelected && !isFocused) e.currentTarget.style.boxShadow = hoverShadow;
        }}
        onMouseLeave={(e) => {
          if (isDragOver) return;
          e.currentTarget.style.background = restBg;
          e.currentTarget.style.boxShadow = restShadow ?? "";
        }}
      >
        {/* Folder avatar */}
        <AvatarTile
          icon={isDragOver ? "lucide:folder-open" : "lucide:folder"}
          iconSize={iconSize}
          className="rounded-lg text-white"
          style={{
            width: avatarSize,
            height: avatarSize,
            ...(isDragOver
              ? { background: "color-mix(in srgb, var(--t-accent) 20%, var(--t-bg-card-avatar))" }
              : {}),
          }}
        />

        {isList ? (
          <>
            {renaming ? (
              <input
                autoFocus
                className="font-medium text-sm bg-transparent outline-hidden flex-1 min-w-0 text-(--t-text-bright)"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleRenameCommit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameCommit();
                  if (e.key === "Escape") { setRenaming(false); setRenameValue(folder.name); }
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <p className="text-sm font-medium-bold truncate w-52 shrink-0 text-(--t-text-bright)">
                {folder.name}
              </p>
            )}
            <p className="text-xs truncate flex-1 text-(--t-text-secondary)">
              {t("folders.card.itemCount", { count: itemCount })}
            </p>
          </>
        ) : (
          <div className="flex-1 min-w-0">
            {renaming ? (
              <input
                autoFocus
                className="text-base font-medium-bold bg-transparent outline-hidden w-full text-(--t-text-bright)"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleRenameCommit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameCommit();
                  if (e.key === "Escape") { setRenaming(false); setRenameValue(folder.name); }
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <p className="text-base font-medium-bold truncate leading-tight text-(--t-text-bright)">
                {folder.name}
              </p>
            )}
            <p className="text-xs mt-0.5 truncate text-(--t-text-secondary)">
              {t("folders.card.itemCount", { count: itemCount })}
            </p>
          </div>
        )}

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); togglePin(); }}
            className={`shrink-0 flex items-center transition-colors ${pinAlwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100 hover:text-(--t-text-bright)"}`}
            style={{ color: pinColor }}
            title={effPinned ? t("folders.card.unpin") : t("folders.card.pin")}
          >
            <Icon icon={pinIcon} width={16} />
          </button>
          {!isSynced && (
            <span title={t("folders.card.cloudSyncDisabled")} className="text-(--t-text-dim) flex items-center">
              <Icon icon="lucide:cloud-off" width={18} />
            </span>
          )}
          {canEdit && <CardActionButton icon="lucide:pencil" title={t("common.action.edit")} onClick={() => onEdit?.()} />}
          {canEdit && <CardActionButton icon="lucide:trash-2" title={t("common.action.delete")} onClick={() => onDelete(folder)} danger />}
        </div>
      </div>

      {ctxPos && (
        <ContextMenu
          pos={ctxPos}
          onClose={closeCtx}
          items={activeMenuItems ?? buildFolderMenuItems({
            t,
            onOpen: onClick,
            editItems: canEdit ? [
              { label: t("common.action.rename"), icon: "lucide:pencil", onClick: () => { setRenameValue(folder.name); setRenaming(true); } },
              { label: t("common.action.edit"), icon: "lucide:settings-2", onClick: () => onEdit?.() },
            ] : [],
            pinItem,
            pinTeamItem,
            onExport,
            onShare,
            vaults,
            canEdit,
            onMoveToVault,
            onCopyToVault,
            clipboard: clipboardMenuItems(t),
            isSynced,
            onToggleSync: () => toggleSync(folder.id),
            onDelete: () => onDelete(folder),
          })}
        />
      )}
    </>
  );
}
