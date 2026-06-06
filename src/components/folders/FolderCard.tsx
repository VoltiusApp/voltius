import { useState } from "react";
import { Icon } from "@iconify/react";
import { CardActionButton } from "@/components/shared/CardActionButton";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import { getShortcutHint } from "@/stores/shortcutStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useTeamStore } from "@/stores/teamStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";
import type { Folder, VaultOption } from "@/types";

interface FolderCardProps {
  folder: Folder;
  itemCount: number;
  layout: "grid" | "list";
  isSelected?: boolean;
  isFocused?: boolean;
  isDragOver?: boolean;
  onClick: () => void;
  onRename: (folder: Folder, newName: string) => void;
  onDelete: (folder: Folder) => void;
  onSelect?: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onEdit?: () => void;
  onExport?: () => void;
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
  onClick,
  onRename,
  onDelete,
  onSelect,
  onEdit,
  onExport,
  onPointerDown,
  vaults,
  canEdit,
  onMoveToVault,
  onCopyToVault,
  bulkContextMenuItems,
  "data-drop-folder": dataDropFolder,
}: FolderCardProps) {
  const isList = layout === "list";
  const avatarSize = isList ? 28 : 48;
  const iconSize = isList ? 14 : 22;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const { pos: ctxPos, open: openCtx, close: closeCtx } = useContextMenu();
  const isSynced = useSyncPrefsStore((s) => s.isObjectSynced(folder.id, "folder"));
  const toggleSync = useSyncPrefsStore((s) => s.toggleExcluded);
  const isSnippetFolder = folder.object_type === "snippet_folder";
  const folderType: "folder" | "snippet_folder" = isSnippetFolder ? "snippet_folder" : "folder";
  const pinFolder = useFolderStore((s) => s.pinFolder);
  const pinFolderForTeam = useFolderStore((s) => s.pinFolderForTeam);
  const pinSnippetFolder = useSnippetFolderStore((s) => s.pinSnippetFolder);
  const pinSnippetFolderForTeam = useSnippetFolderStore((s) => s.pinSnippetFolderForTeam);
  const effPinned = useEffectivePinned(folder, folderType);
  const pinSource = useEffectivePinSource(folder, folderType);
  const isTeamVault = useTeamStore((s) => s.teams.some((t) => t.id === folder.vault_id));
  const pinPersonal = (pinned: boolean | null) => {
    if (isSnippetFolder) pinSnippetFolder(folder.id, pinned).catch(() => {});
    else pinFolder(folder.id, pinned).catch(() => {});
  };
  const pinTeam = (pinned: boolean) => {
    if (isSnippetFolder) pinSnippetFolderForTeam(folder.id, pinned).catch(() => {});
    else pinFolderForTeam(folder.id, pinned).catch(() => {});
  };
  const handlePinClick = () => {
    if (!isTeamVault) {
      pinPersonal(!effPinned);
    } else {
      pinPersonal(nextPersonalPinValue(pinSource));
    }
  };
  const pinIcon = pinSource === "team-hidden" ? "lucide:pin-off" : "lucide:pin";
  const pinColor =
    pinSource === "personal" || pinSource === "team+personal"
      ? "var(--t-accent)"
      : pinSource === "team"
      ? "var(--t-text-secondary)"
      : "var(--t-text-dim)";
  const pinAlwaysVisible = pinSource !== "none" && pinSource !== "team-hidden";
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

  return (
    <>
      <div
        data-folder-card="true"
        data-selectable-id={folder.id}
        data-drop-folder={dataDropFolder}
        className={`group flex items-center px-4 rounded-2xl cursor-pointer transition-all duration-150 ${isList ? "gap-3 py-2" : "gap-4 py-4"}`}
        style={{
          background: isDragOver
            ? "color-mix(in srgb, var(--t-accent) 8%, var(--t-bg-card))"
            : "var(--t-bg-card)",
          border: dragBorder,
          boxShadow: focusBoxShadow,
        }}
        onClick={(e) => { e.stopPropagation(); if (!renaming) onClick(); }}
        onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); onSelect?.(folder.id, e); openCtx(e); }}
        onPointerDown={onPointerDown}
        onMouseEnter={(e) => { if (!isDragOver) e.currentTarget.style.background = "var(--t-bg-card-hover)"; }}
        onMouseLeave={(e) => { if (!isDragOver) e.currentTarget.style.background = "var(--t-bg-card)"; }}
      >
        {/* Folder avatar */}
        <div
          className="rounded-lg flex items-center justify-center shrink-0 select-none"
          style={{
            width: avatarSize,
            height: avatarSize,
            background: isDragOver
              ? "color-mix(in srgb, var(--t-accent) 20%, var(--t-bg-card-avatar))"
              : "var(--t-bg-card-avatar)",
            color: "#fff",
          }}
        >
          <Icon icon={isDragOver ? "lucide:folder-open" : "lucide:folder"} width={iconSize} />
        </div>

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
              <p className="font-medium-bold truncate w-48 shrink-0 text-(--t-text-bright)">
                {folder.name}
              </p>
            )}
            <p className="text-xs truncate flex-1 text-(--t-text-secondary)">
              {itemCount} item{itemCount !== 1 ? "s" : ""}
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
              {itemCount} item{itemCount !== 1 ? "s" : ""}
            </p>
          </div>
        )}

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); handlePinClick(); }}
            className={`shrink-0 flex items-center transition-colors ${pinAlwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100 hover:text-(--t-text-bright)"}`}
            style={{ color: pinColor }}
            title={effPinned ? "Unpin" : "Pin"}
          >
            <Icon icon={pinIcon} width={16} />
          </button>
          {!isSynced && (
            <span title="Cloud sync disabled" className="text-(--t-text-dim) flex items-center">
              <Icon icon="lucide:cloud-off" width={18} />
            </span>
          )}
          {canEdit && <CardActionButton icon="lucide:pencil" title="Edit" onClick={() => onEdit?.()} />}
          {canEdit && <CardActionButton icon="lucide:trash-2" title="Delete" onClick={() => onDelete(folder)} danger />}
        </div>
      </div>

      {ctxPos && (
        <ContextMenu
          pos={ctxPos}
          onClose={closeCtx}
          items={[
            ...(activeMenuItems ?? [
            { label: "Open folder", icon: "lucide:folder-open", onClick: onClick, shortcut: "↩" },
            ...(canEdit ? [
              { label: "Rename", icon: "lucide:pencil", onClick: () => { setRenameValue(folder.name); setRenaming(true); } },
              { label: "Edit", icon: "lucide:settings-2", onClick: () => onEdit?.() },
            ] : []),
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
              label: folder.pinned ? "Unpin for team" : "Pin for team",
              icon: "lucide:users",
              onClick: () => pinTeam(!folder.pinned),
            }] : []),
            { label: "Export folder", icon: "lucide:upload", onClick: () => onExport?.() },
            ...vaultMenuItems(vaults, canEdit, onMoveToVault, onCopyToVault),
            ...(canEdit ? [
              { label: isSynced ? "Disable cloud sync" : "Enable cloud sync", icon: isSynced ? "lucide:cloud-off" : "lucide:cloud", onClick: () => toggleSync(folder.id) },
              { label: "Delete folder", icon: "lucide:trash-2", onClick: () => onDelete(folder), danger: true as const, shortcut: getShortcutHint("delete") },
            ] : []),
            ]),
          ]}
        />
      )}
    </>
  );
}
