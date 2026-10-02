import { useTranslation } from "react-i18next";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useTeamStore } from "@/stores/teamStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";
import type { Folder } from "@/types";

export function useFolderPin(folder: Folder, canEdit?: boolean) {
  const { t } = useTranslation();
  const isSnippetFolder = folder.object_type === "snippet" || folder.object_type === "snippet_folder";
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
  const togglePin = () => {
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

  const pinItem: ContextMenuItem = {
    label: isTeamVault
      ? (pinSource === "personal" || pinSource === "team+personal")
        ? t("folders.card.unpinForMe")
        : pinSource === "team-hidden"
        ? t("folders.card.showInMyView")
        : pinSource === "team"
        ? t("folders.card.hideForMe")
        : t("folders.card.pinForMe")
      : effPinned ? t("folders.card.unpin") : t("folders.card.pin"),
    icon: (pinSource === "personal" || pinSource === "team+personal" || (!isTeamVault && effPinned))
      ? "lucide:pin-off"
      : "lucide:pin",
    onClick: togglePin,
    divider: true,
  };
  const pinTeamItem: ContextMenuItem | null = canEdit && isTeamVault
    ? {
      label: folder.pinned ? t("folders.card.unpinForTeam") : t("folders.card.pinForTeam"),
      icon: "lucide:users",
      onClick: () => pinTeam(!folder.pinned),
    }
    : null;

  return { folderType, effPinned, pinIcon, pinColor, pinAlwaysVisible, togglePin, pinItem, pinTeamItem };
}
