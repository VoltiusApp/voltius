import type { TFunction } from "i18next";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import type { VaultOption } from "@/types";
import { getShortcutHint } from "@/stores/shortcutStore";
import { vaultMenuItems } from "@/utils/vaultMenuItems";

export function buildFolderMenuItems(o: {
  t: TFunction;
  onOpen: () => void;
  editItems?: ContextMenuItem[];
  pinItem: ContextMenuItem;
  pinTeamItem: ContextMenuItem | null;
  onExport?: () => void;
  onShare?: () => void;
  vaults?: VaultOption[];
  canEdit?: boolean;
  onMoveToVault?: (id: string) => void;
  onCopyToVault?: (id: string) => void;
  clipboard: ContextMenuItem[];
  isSynced: boolean;
  onToggleSync: () => void;
  onDelete: () => void;
}): ContextMenuItem[] {
  const { t } = o;
  return [
    { label: t("folders.card.openFolder"), icon: "lucide:folder-open", onClick: o.onOpen, shortcut: "↩" },
    ...(o.editItems ?? []),
    o.pinItem,
    ...(o.pinTeamItem ? [o.pinTeamItem] : []),
    { label: t("folders.card.exportFolder"), icon: "lucide:upload", onClick: () => o.onExport?.() },
    ...(o.onShare ? [{ label: t("snippets.community.shareTitle"), icon: "lucide:globe", onClick: o.onShare }] : []),
    ...vaultMenuItems(o.vaults, o.canEdit, o.onMoveToVault, o.onCopyToVault, t),
    ...o.clipboard,
    ...(o.canEdit ? [
      { label: o.isSynced ? t("folders.card.disableCloudSync") : t("folders.card.enableCloudSync"), icon: o.isSynced ? "lucide:cloud-off" : "lucide:cloud", onClick: o.onToggleSync, divider: true as const },
      { label: t("folders.card.deleteFolder"), icon: "lucide:trash-2", onClick: o.onDelete, danger: true as const, shortcut: getShortcutHint("delete") },
    ] : []),
  ];
}
