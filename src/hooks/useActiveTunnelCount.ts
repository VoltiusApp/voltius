import { useSessionStore } from "@/stores/sessionStore";
import { usePfStates } from "@/hooks/usePfStates";

/** Returns the total number of active tunnels across all connected SSH sessions.
 *
 * Port forwarding is host-scoped: every terminal of the same host receives the
 * same shared tunnel list (with identical tunnel ids). We count the *union* of
 * ids so a host opened in N terminals is not counted N times. */
export function useActiveTunnelCount(): number {
  const sessions = useSessionStore((s) => s.sessions);
  const sshSessionIds = sessions
    .filter((s) => s.type === "ssh" && s.status === "connected")
    .map((s) => s.id);
  const states = usePfStates(sshSessionIds);

  const unique = new Set<string>();
  for (const state of states.values()) {
    for (const tunnel of state.tunnels) unique.add(tunnel.id);
  }
  return unique.size;
}
