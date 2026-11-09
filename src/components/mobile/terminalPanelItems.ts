import type { MobileScreen, MobileSheet } from "@/stores/mobileNavCore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useTerminalPanels, type TerminalPanel } from "@/components/terminal/terminalPanels";

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

/** Items shared by the terminal ⋮ menu and the toggleable panels row: the desktop
 *  panels, with the ones phones already have a native screen for routed there. */
export function terminalPanelItems(panels: TerminalPanel[], args: {
  activeSessionId: string | null;
  connectionIdOfActive: string | undefined;
  nav: NavActions;
}): PanelItem[] {
  const { activeSessionId, connectionIdOfActive, nav } = args;
  const open = (section: string) => {
    switch (section) {
      case "snippets":
        return nav.openSheet({ kind: "snippets", sessionId: activeSessionId ?? undefined });
      case "sftp":
        return connectionIdOfActive && nav.push({ kind: "panel-sftp", connectionId: connectionIdOfActive });
      case "ports":
        return nav.push({ kind: "more-page", page: "port-forwarding" });
      default:
        return activeSessionId && nav.push({ kind: "panel", section, sessionId: activeSessionId });
    }
  };
  return panels
    .filter((p) => !p.desktopOnly)
    .map((p) => ({ key: p.id, icon: p.icon, label: p.title, onTap: () => { open(p.id); } }));
}

export function useTerminalPanelItems(): PanelItem[] {
  const panels = useTerminalPanels();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const connectionIdOfActive = useSessionStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.connectionId);
  const push = useMobileNavStore((s) => s.push);
  const openSheet = useMobileNavStore((s) => s.openSheet);
  return terminalPanelItems(panels, { activeSessionId, connectionIdOfActive, nav: { push, openSheet } });
}
