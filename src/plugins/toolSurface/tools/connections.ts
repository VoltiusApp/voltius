import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate, objectOp } from "./helpers";
import { refusal } from "../refusal";

export const CONNECTION_PERMISSIONS = ["connections:read", "connections:write", "audit"] as const;

const TEAM_REFUSAL = (id: string) =>
  refusal(`connection "${id}" is owned by a team vault and cannot be changed from here`);

/** Project a raw Connection record down to the PluginConnection contract — the
 *  underlying record carries fields (env_vars, notes, vault_id, ...) no verb
 *  declares. */
const toPluginConnection = (c: Record<string, unknown>) => ({
  id: c.id, name: c.name, host: c.host, port: c.port, username: c.username,
  auth_type: c.auth_type, tags: c.tags, identity_id: c.identity_id, jump_hosts: c.jump_hosts,
  connection_type: c.connection_type, icon: c.icon, distro: c.distro, serial_port: c.serial_port,
  ...(c.team ? { team: true } : {}),
});

/** Reject a team-owned connection before dispatch; the runtime also throws. */
const guardTeam = async (ports: ToolSurfacePorts, id: string) => {
  const conn = await ports.api.connections.get(id);
  return conn?.team ? TEAM_REFUSAL(id) : null;
};

const toInput = (a: Record<string, unknown>) => ({
  name: a.name as string | undefined,
  host: String(a.host),
  port: Number(a.port),
  username: String(a.username),
  auth_type: a.authType as "password" | "key",
  identity_id: a.identityId as string | undefined,
  tags: (a.tags as string[] | undefined) ?? [],
});

const CONNECTION_INPUT = {
  name: z.string().optional(),
  host: z.string(),
  port: z.number().int().positive(),
  username: z.string(),
  authType: z.enum(["password", "key"]),
  identityId: z.string().optional(),
  tags: z.array(z.string()).optional(),
};

export function buildConnectionTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);
  return [
    {
      name: "list_connections",
      description:
        "List the user's saved SSH/host connections (id, name, host). `team: true` marks one "
        + "shared through a team vault; it is addressable exactly like a personal connection.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => {
        const conns = await ports.api.connections.list();
        return conns.map((c) => ({
          id: c.id, name: c.name, host: c.host, ...(c.team ? { team: true } : {}),
        }));
      },
    },
    {
      name: "connection_get",
      description:
        "Full details of one saved connection by id, or null when there is none. `team: true` marks "
        + "one shared through a team vault.",
      risk: "auto",
      schema: z.object({ connectionId: z.string() }),
      execute: async (raw) => {
        const conn = await ports.api.connections.get(String(raw.connectionId));
        return conn ? toPluginConnection(conn as unknown as Record<string, unknown>) : null;
      },
    },
    {
      name: "connection_create",
      description:
        "Save a new connection. `identityId` is an id from identity_list; without one the "
        + "connection authenticates as `username`. Returns the new connection's id.",
      risk: "prompt",
      schema: z.object(CONNECTION_INPUT),
      execute: async (raw) =>
        op("connection_create", "agent.object_created", { objectType: "connection" }, raw, async (a) =>
          toPluginConnection(
            (await ports.api.connections.create(toInput(a))) as unknown as Record<string, unknown>,
          )),
    },
    {
      name: "connection_update",
      description:
        "Change fields on a saved connection. Only the fields given are altered. A connection owned "
        + "by a team vault cannot be changed.",
      risk: "prompt",
      schema: z.object({
        connectionId: z.string(),
        name: z.string().optional(),
        host: z.string().optional(),
        port: z.number().int().positive().optional(),
        username: z.string().optional(),
        authType: z.enum(["password", "key"]).optional(),
        identityId: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
      execute: async (raw) => {
        const id = String(raw.connectionId);
        const teamRefusal = await guardTeam(ports, id);
        if (teamRefusal) return teamRefusal;
        return op(
          "connection_update",
          "agent.object_updated",
          { objectType: "connection", objectId: id },
          raw,
          async (a) => {
            const patch: Record<string, unknown> = {};
            if (a.name !== undefined) patch.name = a.name;
            if (a.host !== undefined) patch.host = a.host;
            if (a.port !== undefined) patch.port = Number(a.port);
            if (a.username !== undefined) patch.username = a.username;
            if (a.authType !== undefined) patch.auth_type = a.authType;
            if (a.identityId !== undefined) patch.identity_id = a.identityId;
            if (a.tags !== undefined) patch.tags = a.tags;
            return ports.api.connections.update(id, patch);
          },
        );
      },
    },
    {
      name: "connection_delete",
      description:
        "Delete a saved connection by id. Cannot be undone. A connection owned by a team vault "
        + "cannot be deleted.",
      risk: "prompt",
      schema: z.object({ connectionId: z.string() }),
      execute: async (raw) => {
        const id = String(raw.connectionId);
        const teamRefusal = await guardTeam(ports, id);
        if (teamRefusal) return teamRefusal;
        return op(
          "connection_delete",
          "agent.object_deleted",
          { objectType: "connection", objectId: id },
          raw,
          () => ports.api.connections.delete(id),
        );
      },
    },
    {
      name: "connection_bulk_import",
      description:
        "Save many connections at once. Returns how many landed and their new ids.",
      risk: "prompt",
      schema: z.object({ items: z.array(z.object(CONNECTION_INPUT)).min(1) }),
      execute: async (raw) =>
        op(
          "connection_bulk_import",
          "agent.object_created",
          { objectType: "connection", count: (raw.items as unknown[]).length },
          raw,
          async (a) => {
            const created = await ports.api.connections.bulkImport(
              (a.items as Record<string, unknown>[]).map(toInput),
            );
            return { imported: created.length, ids: created.map((c) => c.id) };
          },
        ),
    },
  ];
}
