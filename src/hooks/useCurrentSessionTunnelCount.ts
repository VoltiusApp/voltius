import { useSessionStore } from "@/stores/sessionStore";
import { usePfState } from "@/hooks/usePfStates";

/** Active tunnel count for the *current* host (the active SSH session).
 *
 * Mirrors what the status bar and Ports panel header show — the active session's
 * `active`-state tunnels — so the Ports tab badge matches them. (For the global
 * total across every session, use `useActiveTunnelCount`.) */
export function useCurrentSessionTunnelCount(): number {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);

  const session = sessions.find((s) => s.id === activeSessionId);
  const isSsh = session?.type === "ssh" && session.status === "connected";
  const tunnels = usePfState(isSsh ? session.id : null)?.tunnels ?? [];

  return tunnels.filter((t) => t.state === "active").length;
}
