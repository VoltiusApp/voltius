import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { BaseCard } from "@/components/shared/BaseCard";
import { CardActionButton, CardMenuButton, CardPinButton } from "@/components/shared/CardActionButton";
import { TagBadge } from "@/components/shared/TagBadge";
import { OverflowTagList } from "@/components/shared/OverflowTagList";
import { SessionPickerPanel } from "@/components/shared/SessionPickerPanel";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import { getShortcutHint } from "@/stores/shortcutStore";
import { clipboardMenuItems } from "@/utils/clipboardMenuItems";
import type { Snippet, Folder, VaultOption } from "@/types";
import { snippetSearchText } from "@/services/snippetSteps";
import { useSnippetStore, snippetToFormData } from "@/stores/snippetStore";
import { useInlineRename } from "@/hooks/useInlineRename";
import { useTeamStore } from "@/stores/teamStore";
import { useUIStore } from "@/stores/uiStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";

interface Props {
  snippet: Snippet;
  onShare?: () => void;
  folders: Folder[];
  isEditing?: boolean;
  isSelected?: boolean;
  isFocused?: boolean;
  dimmed?: boolean;
  layout?: "grid" | "list";
  onEdit: () => void;
  onSelect?: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onInsert: (sessionIds: string[]) => void;
  onExecute: (sessionIds: string[]) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  bulkContextMenuItems?: ContextMenuItem[];
  vaults?: VaultOption[];
  canEdit?: boolean;
  onMoveToVault?: (vaultId: string) => void;
  onCopyToVault?: (vaultId: string) => void;
  syncEnabled?: boolean;
  onToggleSync?: () => void;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export function SnippetCard({
  snippet,
  onShare,
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
  bulkContextMenuItems,
  vaults,
  canEdit,
  onMoveToVault,
  onCopyToVault,
  syncEnabled,
  onToggleSync,
  onPointerDown,
}: Props) {
  const { t } = useTranslation();
  const isList = layout === "list";
  const pinSnippet = useSnippetStore((s) => s.pinSnippet);
  const pinSnippetForTeam = useSnippetStore((s) => s.pinSnippetForTeam);
  const folder = folders.find((f) => f.id === snippet.folder_id);
  const [panelMode, setPanelMode] = useState<"insert" | "execute" | null>(null);
  const effPinned = useEffectivePinned(snippet, "snippet");
  const pinSource = useEffectivePinSource(snippet, "snippet");
  const isTeamVault = useTeamStore((s) => s.teams.some((t) => t.id === snippet.vault_id));
  const updateSnippet = useSnippetStore((s) => s.updateSnippet);
  const rename = useInlineRename(snippet.id, !!canEdit, snippet.name, (name) => { void updateSnippet(snippet.id, { ...snippetToFormData(snippet), name }); });
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
  const pinLabel = isTeamVault
    ? (pinSource === "personal" || pinSource === "team+personal")
      ? t("snippets.card.unpinForMe")
      : pinSource === "team-hidden"
      ? t("snippets.card.showInMyView")
      : pinSource === "team"
      ? t("snippets.card.hideForMe")
      : t("snippets.card.pinForMe")
    : effPinned ? t("snippets.card.unpin") : t("snippets.card.pin");
  const runButtons = (width: number) => (
    <>
      <CardActionButton icon="lucide:arrow-down-to-line" title={t("snippets.card.insert")} reveal={false} width={width} onClick={() => setPanelMode("insert")} />
      <CardActionButton icon="lucide:play" title={t("snippets.card.execute")} reveal={false} width={width} onClick={() => setPanelMode("execute")} />
    </>
  );

  const contextMenuItems: ContextMenuItem[] = [
    { label: t("common.action.edit"), icon: "lucide:pencil",  onClick: onEdit, shortcut: "E" },
    ...rename.menuItems,
    { label: t("snippets.card.duplicate"), icon: "lucide:copy",    onClick: onDuplicate, shortcut: "D" },
    {
      label: pinLabel,
      icon: (pinSource === "personal" || pinSource === "team+personal" || (!isTeamVault && effPinned))
        ? "lucide:pin-off"
        : "lucide:pin",
      onClick: handlePinClick,
      divider: true as const,
    },
    ...(canEdit && isTeamVault ? [{
      label: snippet.favorite ? t("snippets.card.unpinForTeam") : t("snippets.card.pinForTeam"),
      icon: "lucide:users",
      onClick: () => pinSnippetForTeam(snippet.id, !snippet.favorite).catch(() => {}),
    }] : []),
    ...(onToggleSync ? [{
      label: syncEnabled ? t("snippets.card.disableCloudSync") : t("snippets.card.enableCloudSync"),
      icon: syncEnabled ? "lucide:cloud-off" : "lucide:cloud",
      onClick: onToggleSync,
    }] : []),
    {
      label: t("snippets.card.export"),
      icon: "lucide:upload",
      onClick: () => useUIStore.getState().openImportExport("export", { single: { key: "snippets", id: snippet.id } }),
      divider: true as const,
    },
    ...(onShare ? [{
      label: t("snippets.community.shareTitle"),
      icon: "lucide:globe",
      onClick: onShare,
    }] : []),
    ...vaultMenuItems(vaults, canEdit, onMoveToVault, onCopyToVault, t),
    ...clipboardMenuItems(t),
    { label: t("common.action.delete"), icon: "lucide:trash-2", onClick: onDelete, danger: true as const, divider: true as const, shortcut: getShortcutHint("delete") },
  ];

  const cardProps = {
    isEditing,
    isSelected,
    isFocused,
    "data-selectable-id": snippet.id,
    "data-card": snippet.id,
    onPointerDown,
    onClick: (e: React.MouseEvent<HTMLDivElement>) => { if (onSelect) onSelect(snippet.id, e); else onEdit(); },
    onDoubleClick: onEdit,
    contextMenuItems,
    bulkContextMenuItems,
    style: { opacity: dimmed ? 0.45 : 1 },
  };

  if (!isList) {
    return (
      <>
        <BaseCard isList={false} glass {...cardProps}>
          {/* self-start overrides BaseCard's items-center so content is top-left aligned */}
          <div className="flex-1 min-w-0 self-start flex flex-col gap-2.5">
            {/* Header: avatar + name/fav/tags + description */}
            <div className="flex items-start gap-2 min-w-0">
              <AvatarTile icon="lucide:braces" iconSize={14} className="w-8 h-8 rounded-lg" />
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                {/* Name + favorite (pin position) + tags */}
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm font-bold truncate text-(--t-text-bright) flex-1 min-w-0">
                    {rename.editor ?? snippet.name}
                  </p>
                  {pinAlwaysVisible && <CardPinButton color={pinColor} title={pinLabel} onClick={handlePinClick} />}
                  {snippet.tags.slice(0, 2).map((tag) => (
                    <TagBadge key={tag} tag={tag} className="rounded-md shrink-0 py-0 text-[10px]" />
                  ))}
                  {snippet.tags.length > 2 && (
                    <span className="text-[10px] text-(--t-text-dim) shrink-0">+{snippet.tags.length - 2}</span>
                  )}
                </div>
                {/* Description */}
                {snippet.description && (
                  <p className="text-xs text-(--t-text-muted) truncate leading-tight">
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
                  color: snippetSearchText(snippet) ? "var(--t-terminal-foreground)" : "var(--t-text-dim)",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {`> ${snippetSearchText(snippet) || t("snippets.card.noContent")}`}
              </p>
            </div>

            {/* Actions row */}
            <div className="flex items-center justify-between -mt-0.5">
              <div className="flex items-center gap-1 text-xs text-(--t-text-dim)">
                {folder && (
                  <>
                    <Icon icon="lucide:folder" width={10} />
                    <span className="truncate max-w-[80px]">{folder.name}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-0.5">
                {runButtons(15)}
                <CardMenuButton width={15} />
              </div>
            </div>
          </div>
        </BaseCard>

        {panelMode && (
          <SessionPickerPanel
            mode={panelMode}
            onConfirm={(sessionIds) => {
              const action = panelMode === "insert" ? onInsert : onExecute;
              action(sessionIds);
            }}
            onClose={() => setPanelMode(null)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <BaseCard isList {...cardProps}>
        <AvatarTile icon="lucide:braces" iconSize={14} className="w-7 h-7 rounded-lg" />
        <p className="text-sm font-medium-bold truncate w-52 shrink-0 text-(--t-text-bright)">{rename.editor ?? snippet.name}</p>
        <p className={`text-xs truncate flex-1 min-w-0 text-(--t-text-secondary) ${snippet.description ? "" : "font-mono"}`}>
          {snippet.description || snippetSearchText(snippet)}
        </p>
        {folder && (
          <span className="flex items-center gap-1 text-xs text-(--t-text-dim) shrink-0">
            <Icon icon="lucide:folder" width={10} />
            {folder.name}
          </span>
        )}
        {snippet.tags.length > 0 && <OverflowTagList tags={snippet.tags} className="max-w-32 flex-1" />}

        <div className="flex items-center gap-0.5 shrink-0">
          {pinAlwaysVisible && <span className="px-1.5 flex"><CardPinButton color={pinColor} title={pinLabel} onClick={handlePinClick} width={16} /></span>}
          {runButtons(16)}
          <CardMenuButton width={16} />
        </div>
      </BaseCard>

      {panelMode && (
        <SessionPickerPanel
          mode={panelMode}
          onConfirm={(sessionIds) => {
            const action = panelMode === "insert" ? onInsert : onExecute;
            action(sessionIds);
          }}
          onClose={() => setPanelMode(null)}
        />
      )}
    </>
  );
}
