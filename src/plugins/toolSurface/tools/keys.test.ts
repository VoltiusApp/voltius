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
      addToHost: vi.fn(async () => undefined),
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

  it("projects away internal fields from a newly created key", async () => {
    const RAW = { id: "k2", name: "new", key_type: "ed25519", tags: [], vault_id: "v1", clocks: { created: 1 } };
    const { ports } = makePorts({ keys: { create: vi.fn(async () => RAW) } });
    const result = await tool(ports, "key_create").execute({ name: "ci", keyType: "ed25519", privateKey: "-----BEGIN-----" });
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
    expect([...KEY_PERMISSIONS].sort()).toEqual(["audit", "connections:read", "keys:read", "keys:write"]);
  });

  it("exposes key_add_to_host", () => {
    const { ports } = makePorts();
    expect(buildKeyTools(ports).map((t) => t.name)).toContain("key_add_to_host");
  });

  it("defaults location and filename, and never forwards a script", async () => {
    const addToHost = vi.fn(async () => {});
    const { ports } = makePorts({ keys: { addToHost } });
    await tool(ports, "key_add_to_host").execute({ key_id: "k1", connection_id: "c1", script: "rm -rf /" } as never);
    expect(addToHost).toHaveBeenCalledWith({
      keyId: "k1", connectionId: "c1", location: ".ssh", filename: "authorized_keys",
    });
  });

  it("rejects a location or filename carrying shell metacharacters", () => {
    const { ports } = makePorts();
    const schema = tool(ports, "key_add_to_host").schema;
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", location: ".ssh'; curl x|sh; echo '" }).success).toBe(false);
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", filename: "authorized_keys; rm -rf /" }).success).toBe(false);
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", location: "../../etc" }).success).toBe(false);
  });

  it("rejects an absolute location, so the write stays under the remote home", () => {
    const { ports } = makePorts();
    const schema = tool(ports, "key_add_to_host").schema;
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", location: "/etc/cron.d" }).success).toBe(false);
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", location: "/" }).success).toBe(false);
  });

  it("rejects \".\" and \"..\" as whole segments", () => {
    const { ports } = makePorts();
    const schema = tool(ports, "key_add_to_host").schema;
    // location "." + filename ".bashrc" is a login-shell write, not an authorized_keys append.
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", location: "." }).success).toBe(false);
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", location: ".ssh/./x" }).success).toBe(false);
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", filename: ".." }).success).toBe(false);
  });

  it("rejects a path separator in filename", () => {
    const { ports } = makePorts();
    const schema = tool(ports, "key_add_to_host").schema;
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", filename: "../../etc/cron.d/x" }).success).toBe(false);
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", filename: "sub/keys" }).success).toBe(false);
  });

  it("accepts a legitimate relative location and filename", () => {
    const { ports } = makePorts();
    const schema = tool(ports, "key_add_to_host").schema;
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", location: ".ssh" }).success).toBe(true);
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", location: ".ssh/keys.d" }).success).toBe(true);
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", filename: "authorized_keys" }).success).toBe(true);
  });

  it("rejects a '..' hidden past a newline, and a space riding through the class", () => {
    const { ports } = makePorts();
    const schema = tool(ports, "key_add_to_host").schema;
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", location: ".ssh\n../../root" }).success).toBe(false);
    expect(schema.safeParse({ key_id: "k1", connection_id: "c1", location: ".ssh /tmp/evil" }).success).toBe(false);
  });

  it("passes through a caller-supplied location and filename", async () => {
    const addToHost = vi.fn(async () => {});
    const { ports } = makePorts({ keys: { addToHost } });
    await tool(ports, "key_add_to_host").execute({
      key_id: "k1", connection_id: "c1", location: ".ssh/keys.d", filename: "custom_keys",
    });
    expect(addToHost).toHaveBeenCalledWith({
      keyId: "k1", connectionId: "c1", location: ".ssh/keys.d", filename: "custom_keys",
    });
  });

  it("audits the key and the connection, and no key material", async () => {
    const { ports, audit } = makePorts();
    await tool(ports, "key_add_to_host").execute({ key_id: "k1", connection_id: "c1" });
    expect(audit).toHaveBeenCalledWith(
      "mcp",
      "agent.object_updated",
      { tool: "key_add_to_host", approval: "granted", objectType: "key", objectId: "k1", connectionId: "c1" },
      undefined,
    );
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/ssh-|BEGIN|example\.test/);
  });
});
