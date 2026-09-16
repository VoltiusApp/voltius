import { useSessionStore } from "@/stores/sessionStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import type { Connection, TerminalSession } from "@/types";

export function useActiveHostConnection(): { session: TerminalSession | undefined; connection: Connection | undefined } {
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === s.activeSessionId));
  const connections = useAllConnections();
  const connection = session ? connections.find((c) => c.id === session.connectionId) : undefined;
  return { session, connection };
}
