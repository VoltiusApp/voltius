import type { McpToolContribution, PluginAPI } from "@/plugins/api";
import { firstSnapshot, isRemoteSession, DEFAULT_SNAPSHOT_TIMEOUT_MS } from "@/plugins/streamOneShot";

export function buildProcessMcpTools(api: PluginAPI): McpToolContribution[] {
  return [
    {
      name: "process_list",
      description: "One snapshot of the processes running on a host, taken through an open session.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          timeoutMs: { type: "number", description: "Default 8000." },
        },
        required: ["sessionId"],
      },
      mutating: false,
      execute: async (a) =>
        firstSnapshot(
          api.processes,
          String(a.sessionId),
          isRemoteSession(api, String(a.sessionId)),
          Number(a.timeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS),
        ),
    },
    {
      name: "process_kill",
      description:
        "Kill a process by pid on the host a session is connected to. `force` sends SIGKILL "
        + "instead of SIGTERM; unsaved work in that process is lost either way.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          pid: { type: "number" },
          force: { type: "boolean", description: "SIGKILL instead of SIGTERM. Default false." },
        },
        required: ["sessionId", "pid"],
      },
      mutating: true,
      execute: async (a) =>
        api.processes.kill(
          String(a.sessionId),
          Number(a.pid),
          isRemoteSession(api, String(a.sessionId)),
          Boolean(a.force ?? false),
        ),
    },
  ];
}
