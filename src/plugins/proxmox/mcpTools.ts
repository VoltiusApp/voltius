import type { McpToolContribution, PluginAPI } from "@/plugins/api";
import { requireSshSession } from "@/plugins/sessionTargets";

export function buildProxmoxMcpTools(api: PluginAPI): McpToolContribution[] {
  return [
    {
      name: "lxc_list",
      description: "List LXC containers on a Proxmox VE node reached over an SSH session.",
      inputSchema: {
        type: "object",
        properties: { sessionId: { type: "string", description: "An SSH session id from list_sessions." } },
        required: ["sessionId"],
      },
      mutating: false,
      execute: async (a) => api.proxmox.lxc.list(requireSshSession(api, String(a.sessionId))),
    },
    {
      name: "lxc_action",
      description: "Start, stop, shutdown or reboot an LXC container by vmid.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          vmid: { type: "number" },
          action: { type: "string", enum: ["start", "stop", "shutdown", "reboot"] },
        },
        required: ["sessionId", "vmid", "action"],
      },
      mutating: true,
      execute: async (a) =>
        api.proxmox.lxc.action(requireSshSession(api, String(a.sessionId)), Number(a.vmid), String(a.action)),
    },
    {
      name: "snapshot_list",
      description: "List an LXC container's snapshots.",
      inputSchema: {
        type: "object",
        properties: { sessionId: { type: "string" }, vmid: { type: "number" } },
        required: ["sessionId", "vmid"],
      },
      mutating: false,
      execute: async (a) =>
        api.proxmox.lxc.snapshots.list(requireSshSession(api, String(a.sessionId)), Number(a.vmid)),
    },
    {
      name: "snapshot_create",
      description: "Create a snapshot of an LXC container.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          vmid: { type: "number" },
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["sessionId", "vmid", "name"],
      },
      mutating: true,
      execute: async (a) =>
        api.proxmox.lxc.snapshots.create(
          requireSshSession(api, String(a.sessionId)),
          Number(a.vmid),
          String(a.name),
          a.description as string | undefined,
        ),
    },
    {
      name: "snapshot_rollback",
      description:
        "Roll an LXC container back to a snapshot. Discards every change made since it was taken "
        + "and cannot be undone.",
      inputSchema: {
        type: "object",
        properties: { sessionId: { type: "string" }, vmid: { type: "number" }, name: { type: "string" } },
        required: ["sessionId", "vmid", "name"],
      },
      mutating: true,
      execute: async (a) =>
        api.proxmox.lxc.snapshots.rollback(
          requireSshSession(api, String(a.sessionId)),
          Number(a.vmid),
          String(a.name),
        ),
    },
  ];
}
