import { useSessionStore } from "@/stores/sessionStore";
import type { ToastHost } from "@/stores/notificationStore";

export function sessionToastHost(sessionId: string): ToastHost | undefined {
  const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  if (!session || session.type === "local") return undefined;
  return { connectionId: session.connectionId, name: session.connectionName };
}
