import { useCallback, useEffect, useRef, useState } from "react";
import type { DockerTarget, PluginSession } from "@/plugins/api";
import type { ContainerAction, DockerContainer } from "./types";

export interface DockerListState {
  containers: DockerContainer[];
  loading: boolean;
  error: string | null;
  dockerUnreachable: boolean;
}

/** Adapts api.docker to the shape this hook needs — see services.ts's
 *  createDockerListService (desktop nav) vs createMobileDockerListService
 *  (mobile nav), the only difference being where openExecTerminal focuses. */
export interface DockerListService {
  list(target: DockerTarget): Promise<DockerContainer[]>;
  action(target: DockerTarget, containerId: string, action: ContainerAction): Promise<void>;
  /** Opens a docker-exec PTY, registers it as a terminal tab, and switches to
   *  the terminal nav. Each side's implementation owns its own nav focus. */
  openExecTerminal(target: DockerTarget, containerId: string, containerName: string): Promise<void>;
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
 * hook never reaches into the active-session global itself. `service` is injected
 * so each side can back it with its own transport (see services.ts vs
 * @/services/docker.ts).
 */
export function useDockerList(
  service: DockerListService,
  session: PluginSession | undefined,
  opts: { pollMs?: number; enabled?: boolean } = {},
) {
  const pollMs = opts.pollMs ?? 5000;
  // Desktop DockerPanel keeps its own reducer-driven polling and uses this hook
  // only for `openExecTerminal`, so it disables the list polling to stay byte-identical.
  const enabled = opts.enabled ?? true;
  const isRemote = session?.type === "ssh";
  const sessionId = session?.id ?? "";
  const localShell = session?.type === "local" ? (session.localShell ?? null) : null;
  const target: DockerTarget = { sessionId, isRemote, localShell };

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
      const containers = await service.list(target);
      setState({ containers, loading: false, error: null, dockerUnreachable: false });
    } catch (e) {
      const err = String(e);
      setState((s) => ({ ...s, loading: false, error: err, dockerUnreachable: isDockerUnreachable(err) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, session, sessionId, isRemote, localShell]);

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
      await service.action(target, containerId, action);
      await refresh();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [service, session, sessionId, isRemote, localShell, refresh],
  );

  const openExecTerminal = useCallback(
    async (containerId: string, containerName: string) => {
      if (!session) return;
      try {
        await service.openExecTerminal(target, containerId, containerName);
      } catch (e) {
        console.error("[docker] open exec session failed:", e);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [service, session, sessionId, isRemote, localShell],
  );

  return { ...state, isRemote, sessionId, localShell, refresh, act, openExecTerminal };
}
