import { useSessionStore } from "@/stores/sessionStore";
import { useConnection } from "@/hooks/useAllConnections";
import type { Connection, TerminalSession } from "@/types";

export function useActiveHostConnection(): { session: TerminalSession | undefined; connection: Connection | undefined } {
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === s.activeSessionId));
  const connection = useConnection(session?.connectionId);
  return { session, connection };
}
