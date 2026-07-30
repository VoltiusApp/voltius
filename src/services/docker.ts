import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DockerTarget } from "@/plugins/api";
import type { ContainerAction, DockerContainer, DockerLogLine } from "@/plugins/docker/types";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { localConnect, localSendInput } from "@/services/local";

// Mirrors src/plugins/domains/docker.ts (like @/services/proxmox.ts mirrors
// domains/proxmox.ts). Kept as a separate host-side copy because
// MobileDockerScreen/MobileDockerLogsScreen live in the host bundle, not the
// external plugin bundle, and have no access to the plugin's runtime-singleton
// PluginAPI.

export function dockerListContainers(target: DockerTarget): Promise<DockerContainer[]> {
  return invoke("docker_list_containers", { ...target, all: true });
}

export function dockerContainerAction(
  target: DockerTarget,
  containerId: string,
  action: ContainerAction,
): Promise<void> {
  return invoke("docker_container_action", { ...target, containerId, action });
}

export function dockerStartLogStream(
  sessionId: string,
  isRemote: boolean,
  localShell: string | null,
  containerId: string,
  tail: number,
): Promise<string> {
  return invoke("docker_start_log_stream", { sessionId, isRemote, localShell, containerId, tail });
}

export function dockerStopLogStream(streamId: string): Promise<void> {
  return invoke("docker_stop_log_stream", { streamId });
}

export function onDockerLog(streamId: string, cb: (line: DockerLogLine) => void): Promise<UnlistenFn> {
  return listen<DockerLogLine>(`docker:log:${streamId}`, ({ payload }) => cb(payload));
}

/**
 * Opens a docker-exec PTY (remote: a new PTY channel on the existing SSH
 * connection; local: a new local PTY running `docker exec -it … sh`), registers
 * it as a terminal tab, and switches to the mobile terminal tab. Mirrors the
 * plugin-side api.docker.exec.open wiring in runtime.ts, but against the host's
 * own stores directly (no plugin-bundle runtime singleton to go through).
 */
export async function dockerOpenExecTerminal(
  target: DockerTarget,
  containerId: string,
  containerName: string,
): Promise<void> {
  const label = `exec: ${containerName}`;

  if (target.isRemote) {
    const execSessionId = await invoke<string>("docker_open_exec_session", {
      sourceSessionId: target.sessionId,
      containerId,
    });
    const parent = useSessionStore.getState().sessions.find((s) => s.id === target.sessionId);
    useSessionStore.setState((s) => ({
      sessions: [
        ...s.sessions,
        {
          id: execSessionId,
          connectionId: parent?.connectionId ?? "",
          connectionName: label,
          status: "connecting" as const,
          type: "ssh" as const,
          containerExec: { kind: "docker" as const, containerId, parentSessionId: target.sessionId },
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
    useMobileNavStore.getState().setTab("terminal");
    return;
  }

  const newSessionId = crypto.randomUUID();
  useSessionStore.setState((s) => ({
    sessions: [
      ...s.sessions,
      {
        id: newSessionId,
        connectionId: "local",
        connectionName: label,
        status: "connecting" as const,
        type: "local" as const,
        localShell: target.localShell ?? undefined,
      },
    ],
    activeSessionId: newSessionId,
  }));
  try {
    await localConnect(newSessionId, 80, 24, target.localShell ?? undefined);
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
    throw e;
  }
  useMobileNavStore.getState().setTab("terminal");
}
