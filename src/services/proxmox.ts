import { useSessionStore } from "@/stores/sessionStore";

/**
 * Registers an already-opened LXC exec session as a real terminal tab and marks
 * it connected — the same bookkeeping `useSessionStore`'s own connect flows do.
 * Used by the plugin's `api.proxmox.lxc.openShell` wiring in runtime.ts, which
 * has session-store access but not through the plugin-bundle runtime singleton.
 */
export async function registerLxcExecSession(opts: {
  execSessionId: string;
  parentSessionId: string;
  connectionId: string;
  vmid: number;
  vmName?: string;
}): Promise<void> {
  const { execSessionId, parentSessionId, connectionId, vmid, vmName } = opts;
  useSessionStore.setState((s) => ({
    sessions: [
      ...s.sessions,
      {
        id: execSessionId,
        connectionId,
        connectionName: `pct: ${vmName ?? vmid}`,
        status: "connecting" as const,
        type: "ssh" as const,
        containerExec: { kind: "lxc" as const, vmid, parentSessionId },
      },
    ],
    activeSessionId: execSessionId,
  }));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  useSessionStore.setState((s) => ({
    sessions: s.sessions.map((sess) =>
      sess.id === execSessionId ? { ...sess, status: "connected" as const } : sess,
    ),
  }));
}
