import { describe, expect, it, vi } from "vitest";
import { buildConnectionTools, CONNECTION_PERMISSIONS } from "./connections";
import type { ToolSurfacePorts } from "../coreTools";

const TEAM = { id: "t1", name: "team box", host: "t.example", port: 22, username: "u", auth_type: "key", tags: [], team: true };
const MINE = { id: "c1", name: "mine", host: "m.example", port: 22, username: "u", auth_type: "key", tags: [] };
/** What a record with no vault or folder of its own projects to. */
const AT_ROOT = { vault_id: "personal", folder_id: null };

function makePorts(overrides: Record<string, unknown> = {}) {
  const audit = vi.fn();
  const api = {
    connections: {
      list: vi.fn(async () => [MINE, TEAM]),
      get: vi.fn(async (id: string) => [MINE, TEAM].find((c) => c.id === id) ?? null),
      create: vi.fn(async () => ({ ...MINE, id: "c2" })),
      update: vi.fn(async (id: string) => {
        if (id === "t1") throw new Error("cannot modify a team-vault connection");
      }),
      delete: vi.fn(async (id: string) => {
        if (id === "t1") throw new Error("cannot modify a team-vault connection");
      }),
      bulkImport: vi.fn(async (items: unknown[]) => items.map((_, i) => ({ ...MINE, id: `b${i}` }))),
      ...overrides,
    },
  };
  const ports = {
    api,
    approve: async ({ args }: { tool: string; args: Record<string, unknown> }) =>
      ({ approve: true, scope: String(args.connectionId ?? "mcp"), via: "granted", args }),
    audit,
    owned: new Set<string>(),
  } as unknown as ToolSurfacePorts;
  return { ports, api, audit };
}

const tool = (ports: ToolSurfacePorts, name: string) =>
  buildConnectionTools(ports).find((t) => t.name === name)!;

describe("connection mutation verbs", () => {
  it("gets one connection by id", async () => {
    const { ports } = makePorts();
    expect(await tool(ports, "connection_get").execute({ connectionId: "c1" }))
      .toEqual({ ...MINE, ...AT_ROOT });
  });

  it("returns null for an unknown id rather than throwing", async () => {
    const { ports } = makePorts();
    expect(await tool(ports, "connection_get").execute({ connectionId: "zzz" })).toBe(null);
  });

  it("projects away fields outside the PluginConnection contract", async () => {
    const RAW = {
      ...MINE, id: "c3",
      env_vars: { TOKEN: "secret" }, notes: "private notes", pre_command: "echo pre",
      post_command: "echo post", vault_id: "v1", folder_id: "f1", clocks: { created: 1 }, deleted_at: null,
    };
    const { ports } = makePorts({ get: vi.fn(async () => RAW) });
    const result = await tool(ports, "connection_get").execute({ connectionId: "c3" });
    expect(result).not.toHaveProperty("env_vars");
    expect(result).not.toHaveProperty("notes");
    expect(result).not.toHaveProperty("pre_command");
    expect(result).not.toHaveProperty("post_command");
    expect(result).not.toHaveProperty("clocks");
    expect(result).not.toHaveProperty("deleted_at");
    // Placement IS part of the contract: a caller that moved this connection has
    // no other way to see where it landed.
    expect(result).toEqual({ ...MINE, id: "c3", vault_id: "v1", folder_id: "f1" });
  });

  it("creates a connection and audits it against the new id", async () => {
    const { ports, api, audit } = makePorts();
    const result = await tool(ports, "connection_create").execute({
      name: "web", host: "web.example", port: 22, username: "deploy", authType: "key", identityId: "i1",
    });
    expect(api.connections.create).toHaveBeenCalledWith({
      name: "web", host: "web.example", port: 22, username: "deploy",
      auth_type: "key", identity_id: "i1", tags: [],
    });
    expect(audit).toHaveBeenCalledWith(
      "mcp",
      "agent.object_created",
      { tool: "connection_create", approval: "granted", objectType: "connection" },
      undefined,
    );
    expect(result).toEqual({ ok: true, result: { ...MINE, id: "c2", ...AT_ROOT } });
  });

  it("projects away internal fields from a newly created connection", async () => {
    const RAW = {
      ...MINE, id: "c2",
      env_vars: { TOKEN: "secret" }, notes: "private notes", pre_command: "echo pre",
      post_command: "echo post", vault_id: "v1", folder_id: "f1", clocks: { created: 1 }, deleted_at: null,
    };
    const { ports } = makePorts({ create: vi.fn(async () => RAW) });
    const result = await tool(ports, "connection_create").execute({
      name: "web", host: "web.example", port: 22, username: "deploy", authType: "key",
    });
    expect(result).toEqual({ ok: true, result: { ...MINE, id: "c2", vault_id: "v1", folder_id: "f1" } });
  });

  it("forwards an empty name and an empty tag list rather than skipping them", async () => {
    const { ports, api } = makePorts();
    await tool(ports, "connection_update").execute({ connectionId: "c1", name: "", tags: [] });
    expect(api.connections.update).toHaveBeenCalledWith("c1", { name: "", tags: [] });
  });

  it("refuses to update a team connection with an actionable message", async () => {
    const { ports } = makePorts();
    const result = await tool(ports, "connection_update").execute({ connectionId: "t1", name: "x" });
    expect(result).toEqual({
      refused: true,
      error: "connection \"t1\" is owned by a team vault and cannot be changed from here",
    });
  });

  it("refuses to delete a team connection with an actionable message", async () => {
    const { ports, api } = makePorts();
    const result = await tool(ports, "connection_delete").execute({ connectionId: "t1" });
    expect(result).toEqual({
      refused: true,
      error: "connection \"t1\" is owned by a team vault and cannot be changed from here",
    });
    expect(api.connections.delete).not.toHaveBeenCalled();
  });

  it("deletes a personal connection and audits it", async () => {
    const { ports, api, audit } = makePorts();
    expect(await tool(ports, "connection_delete").execute({ connectionId: "c1" }))
      .toEqual({ ok: true, result: null });
    expect(api.connections.delete).toHaveBeenCalledWith("c1");
    expect(audit).toHaveBeenCalledWith(
      "c1",
      "agent.object_deleted",
      { tool: "connection_delete", approval: "granted", objectType: "connection", objectId: "c1" },
      undefined,
    );
  });

  it("bulk-imports and reports how many landed", async () => {
    const { ports, api, audit } = makePorts();
    const items = [{ host: "a", port: 22, username: "u", authType: "key" }];
    const result = await tool(ports, "connection_bulk_import").execute({ items });
    expect(api.connections.bulkImport).toHaveBeenCalledWith([
      { host: "a", port: 22, username: "u", auth_type: "key", tags: [] },
    ]);
    expect(result).toEqual({ ok: true, result: { imported: 1, ids: ["b0"] } });
    expect(audit).toHaveBeenCalledWith(
      "mcp",
      "agent.object_created",
      { tool: "connection_bulk_import", approval: "granted", objectType: "connection", count: 1 },
      undefined,
    );
  });

  it("declares exactly the permissions its verbs reach", () => {
    expect([...CONNECTION_PERMISSIONS].sort()).toEqual(["audit", "connections:read", "connections:write"]);
  });
});
