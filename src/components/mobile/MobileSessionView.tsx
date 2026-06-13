import { useSessionStore } from "@/stores/sessionStore";
import { reconnectWithBackoff } from "@/stores/reconnectBackoff";
import { handleSessionClosed } from "@/stores/reconnectBackoffCore";
import { HostAwareTerminalView, SessionConnectionOverlay } from "@/components/terminal/SessionView";
import type { TerminalSession } from "@/types";

/** Mobile-only wrapper: renders the shared terminal compact inside a hard-clipped box. */
export default function MobileSessionView({ session, active }: { session: TerminalSession; active: boolean }) {
  const markDisconnected = useSessionStore((s) => s.markDisconnected);
  const reconnect = useSessionStore((s) => s.reconnect);
  const reconnectWithPassphrase = useSessionStore((s) => s.reconnectWithPassphrase);
  const retryConnect = useSessionStore((s) => s.retryConnect);
  const removeSession = useSessionStore((s) => s.removeSession);

  return (
    <div className="absolute inset-0" style={{ overflow: "clip", overscrollBehavior: "contain" }}>
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
        active={active}
        compact
        onClosed={() =>
          handleSessionClosed(session.type, session.id, {
            status: (id) => useSessionStore.getState().sessions.find((s) => s.id === id)?.status,
            markDisconnected,
            reconnectWithBackoff,
          })
        }
      />
    </div>
  );
}
