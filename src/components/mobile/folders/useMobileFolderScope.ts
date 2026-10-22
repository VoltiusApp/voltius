import { useMemo, useRef } from "react";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
import { useSharedAxis } from "@/hooks/pageTransition";
import { useVaultScope } from "@/hooks/useVaultScope";
import { usePermissions } from "@/hooks/usePermission";
import type { Folder } from "@/types";

/** The selected vault's folders of one type, with navigation and the vault new items land in. */
export function useMobileFolderScope(allFolders: Folder[], objectType: Folder["object_type"]) {
  const { inScope, createVaultId } = useVaultScope();
  const can = usePermissions();
  const folders = useMemo(
    () => allFolders.filter((f) => f.object_type === objectType && inScope(f)),
    [allFolders, objectType, inScope],
  );
  const open = useFolderNavigation(folders, objectType);
  const folderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const targetVaultId = open.folderPath[open.folderPath.length - 1]?.vault_id ?? createVaultId;

  // Put on the folder list: it slides between levels, and nav describes the level on screen.
  const axisRef = useRef<HTMLDivElement>(null);
  const shownId = useSharedAxis(open.activeFolderId, true, () => axisRef.current,
    (from, to) => to !== null && (from === null || open.folderPath.some((f) => f.id === from)));
  const shown = shownId === open.activeFolderId ? open : open.levelOf(shownId);
  const nav = {
    ...open,
    ...shown,
    navigateTo: (index: number) => (index < 0 ? open.navigateToRoot() : open.navigateInto(shown.folderPath[index])),
  };

  return {
    inScope,
    can,
    nav,
    axisRef,
    openPath: open.folderPath,
    folders,
    folderIds,
    targetVaultId,
    canCreateFolder: can("EDIT_FOLDERS", targetVaultId),
    canEditFolder: (f: Folder) => can("EDIT_FOLDERS", f.vault_id ?? "personal", f.id),
  };
}
