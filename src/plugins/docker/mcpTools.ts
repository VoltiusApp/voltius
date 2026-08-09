import type { DockerTarget, McpToolContribution, PluginAPI } from "@/plugins/api";

/** An MCP client has only a sessionId; PluginSession already carries the type
 *  and shell the DockerTarget triple needs. Refuses an unknown id rather than
 *  defaulting to the user's own machine. */
function targetFor(api: PluginAPI, sessionId: string): DockerTarget {
  const session = api.sessions.list().find((s) => s.id === sessionId);
  if (!session) throw new Error(`no open session with id "${sessionId}"`);
  return {
    sessionId,
    isRemote: session.type !== "local",
    localShell: session.localShell ?? null,
  };
}

const SESSION_ONLY: Record<string, unknown> = {
  type: "object",
  properties: { sessionId: { type: "string", description: "An id from list_sessions." } },
  required: ["sessionId"],
};

export function buildDockerMcpTools(api: PluginAPI): McpToolContribution[] {
  return [
    {
      name: "container_list",
      description: "List Docker containers on the host a session is connected to.",
      inputSchema: SESSION_ONLY,
      mutating: false,
      execute: async (a) => api.docker.containers.list(targetFor(api, String(a.sessionId))),
    },
    {
      name: "container_action",
      description:
        "Run a lifecycle action on a container: start, stop, restart, pause, unpause, kill or "
        + "remove. Removing a container cannot be undone.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          containerId: { type: "string" },
          action: { type: "string", enum: ["start", "stop", "restart", "pause", "unpause", "kill", "remove"] },
        },
        required: ["sessionId", "containerId", "action"],
      },
      mutating: true,
      execute: async (a) =>
        api.docker.containers.action(
          targetFor(api, String(a.sessionId)),
          String(a.containerId),
          String(a.action),
        ),
    },
    {
      name: "container_logs",
      description: "Read the last N lines of a container's logs. Returns a snapshot, not a stream.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          containerId: { type: "string" },
          tail: { type: "number", description: "Lines to read. Default 200." },
        },
        required: ["sessionId", "containerId"],
      },
      mutating: false,
      execute: async (a) => {
        const target = targetFor(api, String(a.sessionId));
        const tail = Number(a.tail ?? 200);
        const streamId = await api.docker.logs.start(target, String(a.containerId), tail);
        try {
          return await collectLines(api, streamId, tail);
        } finally {
          await api.docker.logs.stop(streamId);
        }
      },
    },
    {
      name: "image_list",
      description: "List Docker images on the host a session is connected to.",
      inputSchema: SESSION_ONLY,
      mutating: false,
      execute: async (a) => api.docker.images.list(targetFor(api, String(a.sessionId))),
    },
    {
      name: "volume_list",
      description: "List Docker volumes on the host a session is connected to.",
      inputSchema: SESSION_ONLY,
      mutating: false,
      execute: async (a) => api.docker.volumes.list(targetFor(api, String(a.sessionId))),
    },
    {
      name: "network_list",
      description: "List Docker networks on the host a session is connected to.",
      inputSchema: SESSION_ONLY,
      mutating: false,
      execute: async (a) => api.docker.networks.list(targetFor(api, String(a.sessionId))),
    },
    {
      name: "stack_list",
      description: "List Docker Compose stacks on the host a session is connected to.",
      inputSchema: SESSION_ONLY,
      mutating: false,
      execute: async (a) => api.docker.stacks.list(targetFor(api, String(a.sessionId))),
    },
  ];
}

const LOG_QUIET_MS = 1500;
const LOG_TIMEOUT_MS = 10_000;

/** Logs arrive as a stream; MCP needs one answer. Collects until the lines stop
 *  arriving or the timeout fires, whichever comes first. */
async function collectLines(api: PluginAPI, streamId: string, max: number): Promise<string[]> {
  const lines: string[] = [];
  return new Promise<string[]>((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (quiet) clearTimeout(quiet);
      clearTimeout(hard);
      resolve(lines);
    };
    const hard = setTimeout(done, LOG_TIMEOUT_MS);
    void api.docker.logs.on<{ line: string }>(streamId, (payload) => {
      lines.push(payload.line);
      if (lines.length >= max) return done();
      if (quiet) clearTimeout(quiet);
      quiet = setTimeout(done, LOG_QUIET_MS);
    });
    quiet = setTimeout(done, LOG_QUIET_MS);
  });
}
