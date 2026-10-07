import { useMemo } from "react";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
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
  const nav = useFolderNavigation(folders);
  const folderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const targetVaultId = nav.folderPath[nav.folderPath.length - 1]?.vault_id ?? createVaultId;

  return {
    inScope,
    can,
    nav,
    folders,
    folderIds,
    targetVaultId,
    canCreateFolder: can("EDIT_FOLDERS", targetVaultId),
    canEditFolder: (f: Folder) => can("EDIT_FOLDERS", f.vault_id ?? "personal", f.id),
  };
}
