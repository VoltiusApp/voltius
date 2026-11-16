import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useContextMenu } from "@/components/shared/ContextMenu";
import { useTeamStore } from "@/stores/teamStore";
import { useUIStore } from "@/stores/uiStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useMyUserId } from "@/hooks/useMyUserId";
import { refuseWhilePreviewing } from "@/services/previewGuard";
import { vaultAdminCapabilities, type VaultAdminCapabilities, type VaultAdminTarget } from "./vaultAdminTarget";
import { isVaultNavigation, vaultMenuItems } from "./vaultMenuItems";
import type { VaultDialog } from "./VaultAdminDialogs";

const NO_CAPS: VaultAdminCapabilities = {
  isTeam: false, isOwner: false, canRename: false, canSetLockPolicy: false, canDelete: false, canMakePrivate: false, canLeave: false,
};

/** What the viewer may do with `target`, its member count and whether it can be shared. */
export function useVaultAdminState(target: VaultAdminTarget | null) {
  const { teams, rolesByTeam, membersByTeam } = useTeamStore();
  const accountMode = useSubscriptionStore((s) => s.accountMode);
  const myUserId = useMyUserId();
  const caps = target ? vaultAdminCapabilities(target, teams, rolesByTeam, myUserId) : NO_CAPS;
  const memberCount = target?.teamId ? (membersByTeam[target.teamId]?.length ?? null) : null;
  // Mirrors MembersStack's render gate in VaultHeader: a private vault only has
  // someone to share with once cloud sync is on, but a team vault always does.
  const canShare = accountMode === "server" || caps.isTeam;
  return { caps, memberCount, canShare };
}

export function useVaultAdmin(
  target: VaultAdminTarget | null,
  opts?: { onShare?: () => void; onActivate?: () => void },
) {
  const { t } = useTranslation();
  const openMembersNav = useUIStore((s) => s.openMembersNav);
  const openMembersPanel = useUIStore((s) => s.openMembersPanel);
  const { pos, open: openAtPointer, openAt, close: closeMenu } = useContextMenu();
  const [dialog, setDialog] = useState<VaultDialog>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const { caps, memberCount, canShare } = useVaultAdminState(target);

  const items = target
    ? vaultMenuItems({
        caps, memberCount, canShare, t,
        on: (action) => {
          if (!isVaultNavigation(action) && refuseWhilePreviewing()) return;
          switch (action) {
            case "share": opts?.onShare ? opts.onShare() : setShareOpen(true); return;
            case "members": opts?.onActivate?.(); openMembersNav(); return;
            case "roles":
            case "security": opts?.onActivate?.(); openMembersPanel(action); return;
            case "rename":
            case "makePrivate":
            case "delete":
            case "leave": setDialog(action); return;
          }
        },
      })
    : [];

  const openAtElement = (el: HTMLElement) => openAt(el.getBoundingClientRect());

  return { items, pos, openAtElement, openAtPointer, closeMenu, dialog, setDialog, shareOpen, setShareOpen };
}
