import { describe, expect, it, vi } from "vitest";
import { buildKeyTools } from "./keys";
import type { ToolSurfacePorts } from "../coreTools";

function makePorts(overrides: Partial<{ keys: unknown }> = {}) {
  const audit = vi.fn();
  const api = {
    keys: {
      list: vi.fn(async () => [{ id: "k1", name: "laptop", key_type: "ed25519", tags: [] }]),
      create: vi.fn(async () => ({ id: "k2", name: "new", key_type: "ed25519", tags: [] })),
      delete: vi.fn(async () => undefined),
      ...(overrides.keys ?? {}),
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
  buildKeyTools(ports).find((t) => t.name === name)!;

describe("key verbs", () => {
  it("lists keys as PluginKey records", async () => {
    const { ports } = makePorts();
    const result = await tool(ports, "key_list").execute({});
    expect(result).toEqual([{ id: "k1", name: "laptop", key_type: "ed25519", tags: [] }]);
  });

  it("creates a key and records an object_created row before returning", async () => {
    const { ports, api, audit } = makePorts();
    const result = await tool(ports, "key_create").execute({
      name: "ci", keyType: "ed25519", privateKey: "-----BEGIN-----", publicKey: "ssh-ed25519 AAA",
    });
    expect(api.keys.create).toHaveBeenCalledWith(
      { name: "ci", key_type: "ed25519", tags: [] },
      "-----BEGIN-----",
      "ssh-ed25519 AAA",
    );
    expect(audit).toHaveBeenCalledWith(
      "mcp",
      "agent.object_created",
      { tool: "key_create", approval: "granted", objectType: "key" },
      undefined,
    );
    expect(result).toEqual({ ok: true, result: { id: "k2", name: "new", key_type: "ed25519", tags: [] } });
  });

  it("never puts private key material in the audit metadata", async () => {
    const { ports, audit } = makePorts();
    await tool(ports, "key_create").execute({
      name: "ci", keyType: "ed25519", privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
    });
    expect(JSON.stringify(audit.mock.calls)).not.toContain("BEGIN OPENSSH PRIVATE KEY");
  });

  it("deletes a key and records an object_deleted row", async () => {
    const { ports, api, audit } = makePorts();
    const result = await tool(ports, "key_delete").execute({ id: "k1" });
    expect(api.keys.delete).toHaveBeenCalledWith("k1");
    expect(audit).toHaveBeenCalledWith(
      "mcp",
      "agent.object_deleted",
      { tool: "key_delete", approval: "granted", objectType: "key", objectId: "k1" },
      undefined,
    );
    expect(result).toEqual({ ok: true, result: null });
  });

  it("returns the error instead of throwing when the store rejects", async () => {
    const { ports } = makePorts({ keys: { delete: vi.fn(async () => { throw new Error("in use"); }) } });
    expect(await tool(ports, "key_delete").execute({ id: "k1" })).toEqual({ error: "in use" });
  });

  it("declares exactly the permissions its verbs reach", async () => {
    const { KEY_PERMISSIONS } = await import("./keys");
    expect([...KEY_PERMISSIONS].sort()).toEqual(["audit", "keys:read", "keys:write"]);
  });
});
