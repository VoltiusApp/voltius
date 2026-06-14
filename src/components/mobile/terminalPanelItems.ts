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
}): PanelItem[] {
  const { activeSessionId, connectionIdOfActive, nav, isProxmox } = args;
  return [
    { key: "snippets", icon: "lucide:braces", label: "Snippets", onTap: () => nav.openSheet({ kind: "snippets", sessionId: activeSessionId ?? undefined }) },
    { key: "sftp", icon: "lucide:folder-open", label: "SFTP", onTap: () => { if (connectionIdOfActive) nav.push({ kind: "panel-sftp", connectionId: connectionIdOfActive }); } },
    { key: "docker", icon: "lucide:container", label: "Docker", onTap: () => { if (activeSessionId) nav.push({ kind: "panel-docker", sessionId: activeSessionId }); } },
    { key: "metrics", icon: "lucide:activity", label: "Metrics", onTap: () => { if (activeSessionId) nav.push({ kind: "panel-metrics", sessionId: activeSessionId }); } },
    { key: "processes", icon: "lucide:cpu", label: "Processes", onTap: () => { if (activeSessionId) nav.push({ kind: "panel-processes", sessionId: activeSessionId }); } },
    ...(isProxmox ? [{ key: "proxmox", icon: "devicon:proxmox-plain", label: "Proxmox", onTap: () => { if (activeSessionId) nav.push({ kind: "panel-proxmox", sessionId: activeSessionId }); } }] : []),
  ];
}
