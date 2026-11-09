import { useTranslation } from "react-i18next";
import type { Folder } from "@/types";
import { usePermissions } from "@/hooks/usePermission";
import { useDefaultVaultId } from "@/hooks/useWritableVaultIds";
import { useVaultStore } from "@/stores/vaultStore";
import { newFolderData } from "@/utils/folderTree";

/** New folder for a desktop page: inside the open folder and its vault, else at the root in the default vault. */
export function useNewFolder(objectType: Folder["object_type"], folderPath: Folder[]) {
  const { t } = useTranslation();
  const can = usePermissions();
  const defaultVaultId = useDefaultVaultId();
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const parent = folderPath[folderPath.length - 1];
  const allowed = parent
    ? can("EDIT_FOLDERS", parent.vault_id, parent.id)
    : selectedVaultIds.some((vid) => can("EDIT_FOLDERS", vid));
  return {
    /** Why New folder is greyed out here, or undefined when it is allowed. */
    folderBlocked: allowed ? undefined : t("folders.noPermissionCreate"),
    newFolder: (name: string) => newFolderData(objectType, parent, defaultVaultId, name),
  };
}
