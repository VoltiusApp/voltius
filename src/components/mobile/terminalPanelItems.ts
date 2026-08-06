import type { TFunction } from "i18next";
import type { ContributedAction } from "@/plugins/api";
import type { MobileScreen, MobileSheet } from "@/stores/mobileNavCore";

export interface PanelItem {
  key: string;
  icon: string;
  label: string;
  onTap: () => void;
}

// MobileNavStore is not exported, so type `nav` structurally.
interface NavActions {
  push: (screen: MobileScreen) => void;
  openSheet: (sheet: NonNullable<MobileSheet>) => void;
}

/** Items shared by the terminal ⋮ menu and the toggleable panels row. */
export function terminalPanelItems(args: {
  activeSessionId: string | null;
  connectionIdOfActive: string | undefined;
  nav: NavActions;
  isProxmox?: boolean;
  /** Plugin actions for the `mobile.terminal.panels` slot, appended after the
   *  built-ins so a plugin can never displace them. */
  contributed?: ContributedAction[];
}, t: TFunction): PanelItem[] {
  const { activeSessionId, connectionIdOfActive, nav, isProxmox, contributed } = args;
  return [
    { key: "snippets", icon: "lucide:braces", label: t("common.entity.snippets"), onTap: () => nav.openSheet({ kind: "snippets", sessionId: activeSessionId ?? undefined }) },
    { key: "sftp", icon: "lucide:folder-open", label: t("mobile.panelItems.sftp"), onTap: () => { if (connectionIdOfActive) nav.push({ kind: "panel-sftp", connectionId: connectionIdOfActive }); } },
    { key: "docker", icon: "lucide:container", label: t("mobile.panelItems.docker"), onTap: () => { if (activeSessionId) nav.push({ kind: "panel-docker", sessionId: activeSessionId }); } },
    { key: "metrics", icon: "lucide:activity", label: t("mobile.panelItems.metrics"), onTap: () => { if (activeSessionId) nav.push({ kind: "panel-metrics", sessionId: activeSessionId }); } },
    { key: "processes", icon: "lucide:cpu", label: t("mobile.panelItems.processes"), onTap: () => { if (activeSessionId) nav.push({ kind: "panel-processes", sessionId: activeSessionId }); } },
    ...(isProxmox ? [{ key: "proxmox", icon: "devicon:proxmox-plain", label: t("mobile.panelItems.proxmox"), onTap: () => { if (activeSessionId) nav.push({ kind: "panel-proxmox", sessionId: activeSessionId }); } }] : []),
    ...(contributed ?? []).map((a, i) => ({
      key: `contrib-${i}-${a.label}`,
      icon: a.icon ?? "lucide:puzzle",
      label: a.label,
      onTap: a.onClick,
    })),
  ];
}
