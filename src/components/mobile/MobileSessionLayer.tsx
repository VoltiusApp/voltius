import { useSessionStore } from "@/stores/sessionStore";
import { reconnectWithBackoff } from "@/stores/reconnectBackoff";
import { handleSessionClosed } from "@/stores/reconnectBackoffCore";
import { HostAwareTerminalView, SessionConnectionOverlay } from "@/components/terminal/SessionView";

/** Always mounted in MobileShell; `visible` only toggles visibility so xterm state survives. */
export default function MobileSessionLayer({ visible }: { visible: boolean }) {
  const { sessions, activeSessionId } = useSessionStore();
  const markDisconnected = useSessionStore((s) => s.markDisconnected);
  const reconnect = useSessionStore((s) => s.reconnect);
  const reconnectWithPassphrase = useSessionStore((s) => s.reconnectWithPassphrase);
  const retryConnect = useSessionStore((s) => s.retryConnect);
  const removeSession = useSessionStore((s) => s.removeSession);

  return (
    <div className={`absolute inset-0 ${visible ? "" : "invisible pointer-events-none"}`}>
      {sessions.filter((s) => s.type !== "multiplayer").map((session) => (
        <div
          key={session.id}
          className={`absolute inset-0 ${session.id === activeSessionId ? "z-10" : "z-0 invisible"}`}
        >
          {(session.status === "connecting" || session.status === "error" || session.status === "disconnected") && (
            <SessionConnectionOverlay
              session={session}
              onDismiss={() => removeSession(session.id)}
              onRetry={(session.type === "ssh" || session.type === "serial") ? () => reconnect(session.id) : undefined}
              onRetryWithPassphrase={session.type === "ssh" ? (p, save) => void reconnectWithPassphrase(session.id, p, save) : undefined}
              onRetryWithAuth={session.type === "ssh" ? (o, save) => void retryConnect(session.id, o, save) : undefined}
            />
          )}
          <HostAwareTerminalView
            session={session}
            active={visible && session.id === activeSessionId && session.status === "connected"}
            onClosed={() =>
              handleSessionClosed(session.type, session.id, {
                status: (id) => useSessionStore.getState().sessions.find((s) => s.id === id)?.status,
                markDisconnected,
                reconnectWithBackoff,
              })
            }
          />
        </div>
      ))}
    </div>
  );
}
