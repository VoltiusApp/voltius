import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { localConnect, localSendInput } from "@/services/local";
import { dockerListContainers, dockerContainerAction } from "./services";
import type { ContainerAction, DockerContainer } from "./types";
import type { TerminalSession } from "@/types";

export interface DockerListState {
  containers: DockerContainer[];
  loading: boolean;
  error: string | null;
  dockerUnreachable: boolean;
}

export function isDockerUnreachable(err: string): boolean {
  return (
    err.includes("Docker not available") ||
    err.includes("command not found") ||
    err.includes("connect: no such file") ||
    err.includes("client error (Connect)")
  );
}

/**
 * Session-scoped Docker container list: polls `docker_list_containers`, exposes
 * per-container actions, and the exec-into-terminal flow. The session is passed
 * explicitly (mobile pins one session, desktop feeds its activeSession) so the
 * hook never reaches into the active-session global itself.
 */
export function useDockerList(session: TerminalSession | undefined, opts: { pollMs?: number; enabled?: boolean } = {}) {
  const pollMs = opts.pollMs ?? 5000;
  // Desktop DockerPanel keeps its own reducer-driven polling and uses this hook
  // only for `openExecTerminal`, so it disables the list polling to stay byte-identical.
  const enabled = opts.enabled ?? true;
  const isRemote = session?.type === "ssh";
  const sessionId = session?.id ?? "";
  const localShell = session?.type === "local" ? (session.localShell ?? null) : null;

  const [state, setState] = useState<DockerListState>({
    containers: [],
    loading: false,
    error: null,
    dockerUnreachable: false,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!session || session.status !== "connected") return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const containers = await dockerListContainers(sessionId, isRemote, localShell, true);
      setState({ containers, loading: false, error: null, dockerUnreachable: false });
    } catch (e) {
      const err = String(e);
      setState((s) => ({ ...s, loading: false, error: err, dockerUnreachable: isDockerUnreachable(err) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionId, isRemote, localShell]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!enabled) return;
    if (!session || session.status !== "connected") return;
    void refresh();
    pollRef.current = setInterval(() => void refresh(), pollMs);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, session?.status, pollMs, enabled]);

  const act = useCallback(
    async (containerId: string, action: ContainerAction) => {
      if (!session) return;
      await dockerContainerAction(sessionId, isRemote, localShell, containerId, action);
      await refresh();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, sessionId, isRemote, localShell, refresh],
  );

  // VERBATIM body of DockerPanel.handleOpenTerminal — opens a docker-exec PTY
  // (remote: docker_open_exec_session on the existing SSH conn; local: a new
  // local PTY running `docker exec -it … sh`) and switches to the terminal nav.
  const openExecTerminal = useCallback(
    async (containerId: string, containerName: string) => {
      const newSessionId = crypto.randomUUID();

      if (isRemote) {
        // Open a new PTY channel on the existing SSH connection
        try {
          const execSessionId = await invoke<string>("docker_open_exec_session", {
            sourceSessionId: sessionId,
            containerId,
          });
          useSessionStore.setState((s) => ({
            sessions: [
              ...s.sessions,
              {
                id: execSessionId,
                connectionId: session!.connectionId,
                connectionName: `exec: ${containerName}`,
                status: "connecting" as const,
                type: "ssh" as const,
                containerExec: { kind: "docker" as const, containerId, parentSessionId: sessionId },
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
        } catch (e) {
          console.error("[docker] open exec session failed:", e);
          return;
        }
      } else {
        // Local: spawn a new local PTY running docker exec
        useSessionStore.setState((s) => ({
          sessions: [
            ...s.sessions,
            {
              id: newSessionId,
              connectionId: "local",
              connectionName: `exec: ${containerName}`,
              status: "connecting" as const,
              type: "local" as const,
              localShell: localShell ?? undefined,
            },
          ],
          activeSessionId: newSessionId,
        }));
        try {
          await localConnect(newSessionId, 80, 24, localShell ?? undefined);
          await localSendInput(newSessionId, new TextEncoder().encode(`docker exec -it ${containerId} sh\r`));
          useSessionStore.setState((s) => ({
            sessions: s.sessions.map((sess) =>
              sess.id === newSessionId ? { ...sess, status: "connected" as const } : sess,
            ),
          }));
        } catch (e) {
          useSessionStore.setState((s) => ({
            sessions: s.sessions.map((sess) =>
              sess.id === newSessionId ? { ...sess, status: "error" as const } : sess,
            ),
          }));
          return;
        }
      }

      useUIStore.getState().setActiveNav("terminal");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, isRemote, session?.connectionId, localShell],
  );

  return { ...state, isRemote, sessionId, localShell, refresh, act, openExecTerminal };
}
