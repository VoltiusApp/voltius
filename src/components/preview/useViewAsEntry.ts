import { useTranslation } from "react-i18next";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { useMyUserId } from "@/hooks/useMyUserId";
import { useOwnPermissions } from "@/hooks/usePermission";
import type { PreviewSubject } from "@/services/permissionPreview";
import { useServerPermissionPreview } from "@/services/serverCapabilities";
import { usePreviewStore } from "@/stores/previewStore";
import { useVaultStore } from "@/stores/vaultStore";

export type ViewAsReason = "needsBusiness" | "needsManage" | "self" | "serverTooOld" | "previewing";

export interface ViewAsEntry {
  enabled: boolean;
  reason: ViewAsReason | null;
  reasonText: string | null;
  enter: () => void;
}

export function useViewAsGate(teamId: string): (subject: PreviewSubject) => ViewAsEntry {
  const { t } = useTranslation();
  const can = useOwnPermissions();
  const myUserId = useMyUserId();
  const { locked } = useBusinessLock(teamId);
  const capable = useServerPermissionPreview();
  const previewing = usePreviewStore((s) => s.session !== null);

  return (subject) => {
    const needed = subject.type === "member" ? "MANAGE_MEMBERS" : "MANAGE_ROLES";
    const reason: ViewAsReason | null =
      !can(needed, teamId) ? "needsManage"
      : subject.type === "member" && subject.user_id === myUserId ? "self"
      : locked ? "needsBusiness"
      : !capable ? "serverTooOld"
      : previewing ? "previewing"
      : null;
    return {
      enabled: reason === null,
      reason,
      reasonText: reason && t(`members.viewAs.reason.${reason}`),
      enter: () => {
        const vault = useVaultStore.getState().vaults.find((v) => v.teamId === teamId);
        if (reason === null && vault) usePreviewStore.getState().enter({ teamId, vaultId: vault.id, subject });
      },
    };
  };
}

export const useViewAsEntry = (teamId: string, subject: PreviewSubject): ViewAsEntry => useViewAsGate(teamId)(subject);
