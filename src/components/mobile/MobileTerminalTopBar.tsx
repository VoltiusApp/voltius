import { useState } from "react";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useConnectionStore } from "@/stores/connectionStore";
import type { TerminalSession } from "@/types";
import { terminalPanelItems } from "./terminalPanelItems";

const DOT: Record<TerminalSession["status"], string> = {
  connected: "#3fb950",
  connecting: "#d29922",
  error: "#f85149",
  disconnected: "#8b949e",
};

/** Persistent slim terminal chrome: exit chevron / scrollable session tabs / new / panels menu. */
export default function MobileTerminalTopBar() {
  // Select the raw array (stable ref) and filter in render — a filtering selector
  // returns a fresh array each store update and defeats selector memoization.
  const allSessions = useSessionStore((s) => s.sessions);
  const sessions = allSessions.filter((x) => x.type !== "multiplayer");
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActive = useSessionStore((s) => s.setActive);
  const disconnect = useSessionStore((s) => s.disconnect);
  const setTab = useMobileNavStore((s) => s.setTab);
  const push = useMobileNavStore((s) => s.push);
  const openSheet = useMobileNavStore((s) => s.openSheet);
  const exitTo = useMobileNavStore((s) => s.lastNonTerminalTab);
  const [menuOpen, setMenuOpen] = useState(false);
  // Derive Proxmox gate as a primitive (boolean) — Zustand-safe; no fresh array/object from the selector.
  const activeConnId = allSessions.find((s) => s.id === activeSessionId)?.connectionId;
  const isProxmox = useConnectionStore((s) => s.connections.find((c) => c.id === activeConnId)?.distro === "proxmox");

  return (
    <div
      className="shrink-0 flex items-center h-11 border-b"
      style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}
    >
      <button
        data-mobile-terminal-exit
        onClick={() => setTab(exitTo)}
        className="px-2 h-full text-(--t-text-primary) shrink-0"
        aria-label="Exit terminal"
      >
        <Icon icon="lucide:chevron-left" width={22} />
      </button>
      <div className="flex-1 flex items-center gap-1.5 overflow-x-auto px-1 h-full">
        {sessions.map((s) => {
          const active = s.id === activeSessionId;
          return (
            <span
              key={s.id}
              data-mobile-session-chip={s.id}
              className="flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-1 text-xs font-medium whitespace-nowrap"
              style={{
                background: active ? "var(--t-accent)" : "var(--t-bg-card)",
                color: active ? "#fff" : "var(--t-text-primary)",
                border: "1px solid var(--t-border)",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: DOT[s.status] }} />
              <button onClick={() => setActive(s.id)}>{s.connectionName}</button>
              <button data-mobile-session-close={s.id} onClick={() => void disconnect(s.id)} className="opacity-70">
                <Icon icon="lucide:x" width={12} />
              </button>
            </span>
          );
        })}
      </div>
      <button
        data-mobile-terminal-new
        onClick={() => setTab("hosts")}
        className="px-2 h-full text-(--t-text-primary) shrink-0"
        aria-label="New session"
      >
        <Icon icon="lucide:plus" width={20} />
      </button>
      <div className="relative shrink-0">
        <button
          data-mobile-terminal-menu
          onClick={() => setMenuOpen((v) => !v)}
          className="px-2 h-full text-(--t-text-primary)"
          aria-label="Panels"
        >
          <Icon icon="lucide:ellipsis-vertical" width={20} />
        </button>
        {menuOpen && (
          <div
            className="absolute right-1 top-10 z-50 rounded-xl border py-1 min-w-40"
            style={{ background: "var(--t-bg-modal)", borderColor: "var(--t-border-hover)", boxShadow: "var(--t-elev-2)" }}
            onClick={() => setMenuOpen(false)}
          >
            {terminalPanelItems({
              activeSessionId,
              connectionIdOfActive: allSessions.find((s) => s.id === activeSessionId)?.connectionId,
              nav: { push, openSheet },
              isProxmox,
            }).map((it) => (
              <button
                key={it.key}
                data-mobile-panel={it.key}
                onClick={() => { it.onTap(); setMenuOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-(--t-text-primary)"
              >
                <Icon icon={it.icon} width={16} />
                {it.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
