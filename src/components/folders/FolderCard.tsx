import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { InlineNameEditor } from "@/components/shared/InlineNameEditor";
import { GLASS_BG, GLASS_BG_HOVER, GLASS_SHADOW, GLASS_SHADOW_HOVER } from "@/components/shared/BaseCard";
import { CardActionButton, CardMenuButton, CardMenuContext, CardPinButton } from "@/components/shared/CardActionButton";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { clipboardMenuItems } from "@/utils/clipboardMenuItems";
import { buildFolderMenuItems } from "@/utils/folderMenuItems";
import { folderIcon } from "./folderAppearance";
import { useFolderPin } from "./useFolderPin";
import { useFolderSync } from "./useFolderSync";
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
  onOpen: () => void;
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
  onOpen,
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
  const { pos: ctxPos, open: openCtx, openAt: openCtxAt, close: closeCtx } = useContextMenu();
  const sync = useFolderSync(folder);
  const { pinColor, pinAlwaysVisible, togglePin, pinItem, pinTeamItem } = useFolderPin(folder, canEdit);
  const activeMenuItems = isSelected && bulkContextMenuItems?.length ? bulkContextMenuItems : undefined;

  const commitRename = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== folder.name) onRename(folder, trimmed);
    setRenaming(false);
  };
  const nameClass = isList
    ? "text-sm font-medium-bold truncate w-52 shrink-0 text-(--t-text-bright)"
    : "text-base font-medium-bold truncate leading-tight text-(--t-text-bright)";
  const name = (
    <p className={nameClass}>
      {renaming
        ? <InlineNameEditor value={folder.name} onCommit={commitRename} onCancel={() => setRenaming(false)} maxLength={255} className="w-full bg-transparent outline-hidden" />
        : folder.name}
    </p>
  );

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
        onClick={(e) => { e.stopPropagation(); if (!renaming) onSelect?.(folder.id, e); }}
        onDoubleClick={() => { if (!renaming) onOpen(); }}
        onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); if (!isSelected) onSelect?.(folder.id, e); openCtx(e); }}
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
          icon={isDragOver ? "lucide:folder-open" : folderIcon(folder)}
          base={folder.color}
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
            {name}
            <p className="text-xs truncate flex-1 text-(--t-text-secondary)">
              {t("folders.card.itemCount", { count: itemCount })}
            </p>
          </>
        ) : (
          <div className="flex-1 min-w-0">
            {name}
            <p className="text-xs mt-0.5 truncate text-(--t-text-secondary)">
              {t("folders.card.itemCount", { count: itemCount })}
            </p>
          </div>
        )}

        <div className="flex items-center gap-1 shrink-0">
          {pinAlwaysVisible && <CardPinButton color={pinColor} title={t("folders.card.unpin")} onClick={togglePin} width={16} />}
          {!sync.isSynced && (
            <span title={t("folders.card.cloudSyncDisabled")} className="text-(--t-text-dim) flex items-center">
              <Icon icon="lucide:cloud-off" width={18} />
            </span>
          )}
          {isList && canEdit && <CardActionButton icon="lucide:pencil" title={t("common.action.edit")} onClick={() => onEdit?.()} />}
          {isList && canEdit && <CardActionButton icon="lucide:trash-2" title={t("common.action.delete")} onClick={() => onDelete(folder)} danger />}
          <CardMenuContext.Provider value={(e) => { if (!isSelected) onSelect?.(folder.id, e as React.MouseEvent<HTMLDivElement>); openCtxAt(e.currentTarget.getBoundingClientRect()); }}>
            <CardMenuButton />
          </CardMenuContext.Provider>
        </div>
      </div>

      {ctxPos && (
        <ContextMenu
          pos={ctxPos}
          onClose={closeCtx}
          items={activeMenuItems ?? buildFolderMenuItems({
            t,
            onOpen,
            editItems: canEdit ? [
              { label: t("common.action.rename"), icon: "lucide:text-cursor-input", onClick: () => setRenaming(true) },
              { label: t("common.action.edit"), icon: "lucide:pencil", onClick: () => onEdit?.() },
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
            ...sync,
            onDelete: () => onDelete(folder),
          })}
        />
      )}
    </>
  );
}
