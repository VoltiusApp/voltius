import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import type { VaultAdminCapabilities } from "./vaultAdminTarget";

export type VaultMenuAction =
  | "share" | "members" | "roles" | "rename" | "makePrivate" | "delete";

/**
 * Built from what the vault is, never from disabled rows: a private vault has no
 * members to manage and no team to leave, so those entries simply do not exist.
 */
export function vaultMenuItems({
  caps, memberCount, canShare, t, on,
}: {
  caps: VaultAdminCapabilities;
  memberCount: number | null;
  canShare: boolean;
  t: (key: string) => string;
  on: (action: VaultMenuAction) => void;
}): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  if (canShare) {
    items.push({ label: t("layout.vaultMenu.share"), icon: "lucide:share-2", onClick: () => on("share") });
  }

  if (caps.isTeam) {
    items.push({
      label: t("layout.vaultMenu.members"),
      icon: "lucide:users-round",
      shortcut: memberCount !== null ? String(memberCount) : undefined,
      onClick: () => on("members"),
    });
    items.push({ label: t("layout.vaultMenu.roles"), icon: "lucide:shield", onClick: () => on("roles") });
  }

  if (caps.canRename) {
    items.push({
      label: t("layout.vaultMenu.rename"),
      icon: "lucide:pencil",
      divider: true,
      onClick: () => on("rename"),
    });
  }

  if (caps.canMakePrivate) {
    items.push({
      label: t("layout.vaultMenu.makePrivate"),
      icon: "lucide:lock",
      divider: true,
      onClick: () => on("makePrivate"),
    });
  }

  if (caps.canDelete) {
    items.push({
      label: t("layout.vaultMenu.delete"),
      icon: "lucide:trash-2",
      danger: true,
      divider: !caps.canMakePrivate,
      onClick: () => on("delete"),
    });
  }

  return items;
}
