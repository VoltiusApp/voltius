import type { TFunction } from "i18next";

export function objectSyncItem(isSynced: boolean, t: TFunction): { label: string; icon: string } {
  return isSynced
    ? { label: t("common.objectSync.disable"), icon: "lucide:cloud-off" }
    : { label: t("common.objectSync.enable"), icon: "lucide:cloud" };
}
