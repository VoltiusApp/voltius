import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useUIContributions } from "@/hooks/useUIContributions";
import { terminalPanelItems } from "./terminalPanelItems";

/** Toggleable quick-access row of terminal panels (mirrors the ⋮ menu). */
export default function MobileTerminalPanelsRow() {
  const { t } = useTranslation();
  const allSessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const push = useMobileNavStore((s) => s.push);
  const openSheet = useMobileNavStore((s) => s.openSheet);
  const activeConnId = allSessions.find((s) => s.id === activeSessionId)?.connectionId;
  const isProxmox = useConnectionStore((s) => s.connections.find((c) => c.id === activeConnId)?.distro === "proxmox");
  // Same context shape the desktop terminal status-bar slot gets, minus the
  // fields a plugin cannot use from a menu item.
  const contributed = useUIContributions("mobile.terminal.panels", {
    sessionId: activeSessionId ?? undefined,
    connectionId: activeConnId,
  });
  const items = terminalPanelItems({
    activeSessionId,
    connectionIdOfActive: activeConnId,
    nav: { push, openSheet },
    isProxmox,
    contributed,
  }, t);
  return (
    <div data-mobile-panels-row className="shrink-0 flex items-center gap-1 overflow-x-auto px-1.5 py-1.5 border-t"
      style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}>
      {items.map((it) => (
        <button key={it.key} data-mobile-panel-quick={it.key} onClick={it.onTap}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "var(--t-bg-card)", color: "var(--t-text-primary)", border: "1px solid var(--t-border)" }}>
          <Icon icon={it.icon} width={15} />{it.label}
        </button>
      ))}
    </div>
  );
}
