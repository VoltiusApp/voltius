import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";

/** Chrome around the (separately mounted) session layer: session chips + empty state. */
export default function MobileTerminalScreen() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActive = useSessionStore((s) => s.setActive);
  const disconnect = useSessionStore((s) => s.disconnect);
  const setTab = useMobileNavStore((s) => s.setTab);

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-(--t-text-dim)">
        <Icon icon="lucide:square-terminal" width={32} />
        <span className="text-sm">No active sessions</span>
        <button
          data-mobile-pick-host
          className="text-sm px-4 py-2 rounded-xl font-medium"
          style={{ background: "var(--t-accent)", color: "#fff" }}
          onClick={() => setTab("hosts")}
        >
          Pick a host
        </button>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 flex gap-1.5 overflow-x-auto px-2 py-1.5 border-b"
      style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}
    >
      {sessions.map((s) => {
        const active = s.id === activeSessionId;
        return (
          <span
            key={s.id}
            data-mobile-session-chip={s.id}
            className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap"
            style={{
              background: active ? "var(--t-accent)" : "var(--t-bg-card)",
              color: active ? "#fff" : "var(--t-text-primary)",
              border: "1px solid var(--t-border)",
            }}
          >
            <button onClick={() => setActive(s.id)}>{s.connectionName}</button>
            <button data-mobile-session-close={s.id} onClick={() => void disconnect(s.id)} className="opacity-70">
              <Icon icon="lucide:x" width={12} />
            </button>
          </span>
        );
      })}
    </div>
  );
}
