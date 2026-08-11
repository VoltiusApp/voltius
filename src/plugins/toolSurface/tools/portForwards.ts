import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import type { PluginPortForwardInput } from "@/plugins/api";
import { makeGate, objectOp, toPatch } from "./helpers";

export const PORT_FORWARD_PERMISSIONS = [
  "port_forwarding:read", "port_forwarding:write", "ports:forward", "sessions:read", "audit",
] as const;

const port = z.number().int().min(1).max(65535);

const RULE_INPUT = {
  name: z.string(),
  local_port: port,
  remote_port: port,
  remote_host: z.string(),
  tunnel_type: z.enum(["local", "remote", "dynamic"]),
  bind_host: z.string().optional(),
  target_host: z.string().optional(),
  description: z.string().optional(),
  connection_ids: z.array(z.string()).optional(),
  folder_id: z.string().optional(),
  vault_id: z.string().optional(),
};

export function buildPortForwardTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);
  return [
    {
      name: "port_forward_list",
      description:
        "List the saved port forwarding rules — the tunnel shapes the user has stored — with their "
        + "ports, type, and the vault and folder each is filed in. A rule is not a running tunnel; "
        + "port_forward_tunnels lists those.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => ports.api.portForwards.list(),
    },
    {
      name: "port_forward_create",
      description:
        "Save a new port forwarding rule. `tunnel_type` is \"local\" (a port on this machine reaches "
        + "a remote address), \"remote\" (the reverse) or \"dynamic\" (a SOCKS proxy). Saving does "
        + "not open anything — use port_forward_start. Returns the new rule.",
      risk: "prompt",
      schema: z.object(RULE_INPUT),
      execute: async (raw) =>
        op("port_forward_create", "agent.object_created", { objectType: "port_forward" }, raw, (a) =>
          ports.api.portForwards.create(a as unknown as PluginPortForwardInput)),
    },
    {
      name: "port_forward_update",
      description:
        "Change fields on a saved port forwarding rule. Only the fields given are altered. A rule in "
        + "a team vault cannot be changed. A tunnel already open keeps the shape it started with.",
      risk: "prompt",
      // The required fields of a create are optional in a patch.
      schema: z.object({
        ...RULE_INPUT,
        id: z.string(),
        name: z.string().optional(),
        local_port: port.optional(),
        remote_port: port.optional(),
        remote_host: z.string().optional(),
        tunnel_type: z.enum(["local", "remote", "dynamic"]).optional(),
      }),
      execute: async (raw) =>
        op("port_forward_update", "agent.object_updated", { objectType: "port_forward", objectId: String(raw.id) }, raw, (a) =>
          ports.api.portForwards.update(String(a.id), toPatch<PluginPortForwardInput>(a))),
    },
    {
      name: "port_forward_delete",
      description:
        "Delete a saved port forwarding rule by id. Cannot be undone. A rule in a team vault cannot "
        + "be deleted. A tunnel already open from it keeps running.",
      risk: "prompt",
      schema: z.object({ id: z.string() }),
      execute: async (raw) =>
        op("port_forward_delete", "agent.object_deleted", { objectType: "port_forward", objectId: String(raw.id) }, raw, (a) =>
          ports.api.portForwards.delete(String(a.id))),
    },
    {
      name: "port_forward_tunnels",
      description:
        "List the tunnels open right now on one session, with their state and bytes transferred. "
        + "`sessionId` is an id from list_sessions.",
      risk: "auto",
      schema: z.object({ sessionId: z.string() }),
      execute: async (raw) => ports.api.portForwards.tunnels(String(raw.sessionId)),
    },
    {
      name: "port_forward_start",
      // Says plainly what it does to the machine: unlike the object verbs this
      // one binds a socket, and a model reading only the name would take it for
      // another piece of bookkeeping.
      description:
        "Open a saved rule's tunnel on an open session. This binds a listening socket on the user's "
        + "machine (or on the remote host for a \"remote\" rule) until the tunnel is stopped or the "
        + "session closes. `sessionId` is an id from list_sessions. Returns the tunnel, including "
        + "the id port_forward_stop takes.",
      risk: "prompt",
      schema: z.object({ id: z.string(), sessionId: z.string() }),
      execute: async (raw) =>
        // agent.command_run, not an object action: nothing is created, changed
        // or deleted in the vault. The audit vocabulary is a closed set the team
        // ingest whitelists, so a new name here would drop every team row.
        op(
          "port_forward_start",
          "agent.command_run",
          { objectType: "port_forward", objectId: String(raw.id) },
          raw,
          (a) => ports.api.portForwards.start(String(a.id), String(a.sessionId)),
        ),
    },
    {
      name: "port_forward_stop",
      description:
        "Close a tunnel that is open on a session. `tunnelId` is an id from port_forward_tunnels; "
        + "the saved rule it came from is untouched.",
      risk: "prompt",
      schema: z.object({ sessionId: z.string(), tunnelId: z.string() }),
      execute: async (raw) =>
        op(
          "port_forward_stop",
          "agent.command_run",
          { objectType: "port_forward", objectId: String(raw.tunnelId) },
          raw,
          async (a) => {
            await ports.api.portForwards.stop(String(a.sessionId), String(a.tunnelId));
            return null;
          },
        ),
    },
  ];
}
