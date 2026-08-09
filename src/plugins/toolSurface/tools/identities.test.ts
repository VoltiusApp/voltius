import { describe, expect, it, vi } from "vitest";
import { buildIdentityTools, IDENTITY_PERMISSIONS } from "./identities";
import type { ToolSurfacePorts } from "../coreTools";

function makePorts(overrides: Record<string, unknown> = {}) {
  const audit = vi.fn();
  const api = {
    identities: {
      list: vi.fn(async () => [{ id: "i1", name: "root", username: "root", tags: [] }]),
      create: vi.fn(async () => ({ id: "i2", name: "deploy", username: "deploy", tags: [] })),
      delete: vi.fn(async () => undefined),
      ...overrides,
    },
  };
  const ports = {
    api,
    approve: async ({ args }: { args: Record<string, unknown> }) => ({ approve: true, scope: "mcp", via: "granted", args }),
    audit,
    owned: new Set<string>(),
  } as unknown as ToolSurfacePorts;
  return { ports, api, audit };
}

const tool = (ports: ToolSurfacePorts, name: string) =>
  buildIdentityTools(ports).find((t) => t.name === name)!;

describe("identity verbs", () => {
  it("lists identities", async () => {
    const { ports } = makePorts();
    expect(await tool(ports, "identity_list").execute({})).toEqual([
      { id: "i1", name: "root", username: "root", tags: [] },
    ]);
  });

  it("creates an identity linked to a key", async () => {
    const { ports, api, audit } = makePorts();
    const result = await tool(ports, "identity_create").execute({
      name: "deploy", username: "deploy", keyId: "k1",
    });
    expect(api.identities.create).toHaveBeenCalledWith({
      name: "deploy", username: "deploy", key_id: "k1", tags: [],
    });
    expect(audit).toHaveBeenCalledWith(
      "mcp",
      "agent.object_created",
      { tool: "identity_create", approval: "granted", objectType: "identity" },
      undefined,
    );
    expect(result).toEqual({ ok: true, result: { id: "i2", name: "deploy", username: "deploy", tags: [] } });
  });

  it("projects away internal fields from a newly created identity", async () => {
    const RAW = { id: "i2", name: "deploy", username: "deploy", tags: [], vault_id: "v1", clocks: { created: 1 } };
    const { ports } = makePorts({ create: vi.fn(async () => RAW) });
    const result = await tool(ports, "identity_create").execute({ name: "deploy", username: "deploy" });
    expect(result).toEqual({ ok: true, result: { id: "i2", name: "deploy", username: "deploy", tags: [] } });
  });

  it("requires a username", () => {
    const { ports } = makePorts();
    expect(tool(ports, "identity_create").schema.safeParse({ name: "x" }).success).toBe(false);
  });

  it("deletes an identity and records an object_deleted row", async () => {
    const { ports, api, audit } = makePorts();
    expect(await tool(ports, "identity_delete").execute({ id: "i1" })).toEqual({ ok: true, result: null });
    expect(api.identities.delete).toHaveBeenCalledWith("i1");
    expect(audit).toHaveBeenCalledWith(
      "mcp",
      "agent.object_deleted",
      { tool: "identity_delete", approval: "granted", objectType: "identity", objectId: "i1" },
      undefined,
    );
  });

  it("returns the error instead of throwing when the store rejects", async () => {
    const { ports } = makePorts({ delete: vi.fn(async () => { throw new Error("referenced"); }) });
    expect(await tool(ports, "identity_delete").execute({ id: "i1" })).toEqual({ error: "referenced" });
  });

  it("declares exactly the permissions its verbs reach", () => {
    expect([...IDENTITY_PERMISSIONS].sort()).toEqual(["audit", "identities:read", "identities:write"]);
  });
});
