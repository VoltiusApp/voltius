import { useSessionStore } from "@/stores/sessionStore";
import type { ContainerExec } from "@/types";

/** Registers an opened container exec session (docker exec, `pct exec`) as a
 * connected terminal tab, the bookkeeping `useSessionStore`'s connect flows do. */
export async function registerExecSession(
  execSessionId: string,
  connectionName: string,
  containerExec: ContainerExec,
): Promise<void> {
  useSessionStore.setState((s) => {
    const parent = s.sessions.find((x) => x.id === containerExec.parentSessionId);
    return {
      sessions: [
        ...s.sessions,
        {
          id: execSessionId,
          connectionId: parent?.connectionId ?? "",
          connectionName,
          status: "connecting" as const,
          type: "ssh" as const,
          containerExec,
          connectedUsername: parent?.connectedUsername,
        },
      ],
      activeSessionId: execSessionId,
    };
  });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  useSessionStore.setState((s) => ({
    sessions: s.sessions.map((sess) =>
      sess.id === execSessionId ? { ...sess, status: "connected" as const } : sess,
    ),
  }));
}
