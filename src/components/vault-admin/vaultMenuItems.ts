import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import type { VaultAdminCapabilities } from "./vaultAdminTarget";

export type VaultMenuAction =
  | "share" | "members" | "roles" | "security" | "rename" | "makePrivate" | "delete" | "leave";

const NAVIGATION_ACTIONS: ReadonlySet<VaultMenuAction> = new Set(["members", "roles", "security"]);

/** Opens a page without changing the vault, so a View-as preview still allows it. */
export const isVaultNavigation = (action: VaultMenuAction): boolean => NAVIGATION_ACTIONS.has(action);

/** Icon of each vault action, shared by the desktop menu and the mobile vault settings page. */
export const VAULT_ACTION_ICONS: Record<VaultMenuAction, string> = {
  share: "lucide:share-2",
  members: "lucide:users-round",
  roles: "lucide:shield",
  security: "lucide:shield-check",
  rename: "lucide:text-cursor-input",
  makePrivate: "lucide:lock",
  delete: "lucide:trash-2",
  leave: "lucide:log-out",
};

/**
 * The actions a vault offers, in menu order. Built from what the vault is, never from
 * disabled rows: a private vault has no members to manage and no team to leave, so
 * those entries simply do not exist.
 */
export function vaultMenuActions({ caps, canShare }: { caps: VaultAdminCapabilities; canShare: boolean }): VaultMenuAction[] {
  const actions: VaultMenuAction[] = [];
  if (canShare) actions.push("share");
  if (caps.isTeam) {
    actions.push("members", "roles");
    if (caps.canSetLockPolicy) actions.push("security");
  }
  if (caps.canRename) actions.push("rename");
  if (caps.canMakePrivate) actions.push("makePrivate");
  if (caps.canDelete) actions.push("delete");
  if (caps.canLeave) actions.push("leave");
  return actions;
}

export function vaultMenuItems({
  caps, memberCount, canShare, t, on,
}: {
  caps: VaultAdminCapabilities;
  memberCount: number | null;
  canShare: boolean;
  t: (key: string) => string;
  on: (action: VaultMenuAction) => void;
}): ContextMenuItem[] {
  return vaultMenuActions({ caps, canShare }).map((action): ContextMenuItem => {
    // Rename opens the edit group; make-private, else delete, opens the destructive one.
    const divider = action === "delete" ? !caps.canMakePrivate
      : action === "rename" || action === "makePrivate" || action === "leave" ? true : undefined;
    return {
      label: t(`layout.vaultMenu.${action}`),
      icon: VAULT_ACTION_ICONS[action],
      ...(action === "members" && memberCount !== null && { shortcut: String(memberCount) }),
      ...((action === "delete" || action === "leave") && { danger: true }),
      ...(divider !== undefined && { divider }),
      onClick: () => on(action),
    };
  });
}
