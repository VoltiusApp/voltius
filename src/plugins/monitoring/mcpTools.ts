import type { McpToolContribution, PluginAPI } from "@/plugins/api";
import { firstSnapshot, isRemoteSession, DEFAULT_SNAPSHOT_TIMEOUT_MS } from "@/plugins/streamOneShot";

export function buildMonitoringMcpTools(api: PluginAPI): McpToolContribution[] {
  return [
    {
      name: "metrics_snapshot",
      description:
        "One reading of a host's CPU, memory, disk and network usage, taken through an open "
        + "session.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "An id from list_sessions." },
          timeoutMs: { type: "number", description: "How long to wait for the first reading. Default 8000." },
        },
        required: ["sessionId"],
      },
      mutating: false,
      execute: async (a) =>
        firstSnapshot(
          api.metrics,
          String(a.sessionId),
          isRemoteSession(api, String(a.sessionId)),
          Number(a.timeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS),
        ),
    },
  ];
}
