import type { TFunction } from "i18next";

export function objectSyncItem(
  isSynced: boolean,
  t: TFunction,
  icon: "action" | "state" = "action",
): { label: string; icon: string } {
  const showsCloud = icon === "state" ? isSynced : !isSynced;
  return {
    label: t(isSynced ? "common.objectSync.disable" : "common.objectSync.enable"),
    icon: showsCloud ? "lucide:cloud" : "lucide:cloud-off",
  };
}
