import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { buildMcpTools, listToolDescriptors, callTool, MCP_TEXT } from "./consumer";
import * as toolSurface from "@voltius/tools";

const api = () => ({
  connections: { list: vi.fn().mockResolvedValue([{ id: "c1", name: "Prod", host: "h1", team: true }]) },
  sessions: { list: vi.fn().mockReturnValue([{ id: "s1", type: "ssh", status: "connected", connectionId: "c1" }]) },
  sftp: { mkdir: vi.fn().mockResolvedValue(undefined) },
  audit: { record: vi.fn() },
}) as never;

const ALL_TOOLS = [
  "audit_query",
  "close_session",
  "connection_bulk_import", "connection_create", "connection_delete", "connection_get", "connection_update",
  "delete_path", "identity_create", "identity_delete", "identity_list",
  "key_create", "key_delete", "key_list",
  "list_connections", "list_files", "list_sessions",
  "make_dir", "open_session", "read_file", "read_terminal", "rename_path",
  "run_command", "stat_file", "transfer_file", "write_file",
];

describe("MCP consumer", () => {
  it("exposes the whole shared tool surface, mutating verbs included", () => {
    expect(buildMcpTools(api(), new Set()).map((t) => t.name).sort()).toEqual(ALL_TOOLS);
  });

  it("no description claims Voltius prompts: the MCP client is the only gate", () => {
    for (const t of buildMcpTools(api(), new Set())) {
      expect(t.description.toLowerCase()).not.toContain("prompt");
      expect(t.description.toLowerCase()).not.toContain("agent");
      expect(t.description.toLowerCase()).not.toContain("workbench");
    }
  });

  it("every text override names a tool that exists, so a typo cannot silently do nothing", () => {
    const names = new Set(buildMcpTools(api(), new Set()).map((t) => t.name));
    for (const name of Object.keys(MCP_TEXT.descriptions)) expect(names.has(name)).toBe(true);
  });

  it("scopes an audit row on the real connection, not the constant", async () => {
    const record = vi.fn();
    const a = api() as unknown as { audit: { record: typeof record } };
    a.audit.record = record;
    const tools = buildMcpTools(a as never, new Set());
    await callTool(tools, "make_dir", { target: "c1", path: "/tmp/x" });
    expect(record).toHaveBeenCalledWith("c1", "agent.file_created", expect.objectContaining({ via: "mcp" }), expect.anything());
  });

  it("close_session on an unowned session returns MCP's own not-owned text, not the agent's default", async () => {
    const tools = buildMcpTools(api(), new Set());
    const out = await callTool(tools, "close_session", { sessionId: "s1" });
    expect(out).toEqual({ ok: true, result: { error: MCP_TEXT.notOwnedError } });
  });

  it("converts each tool's zod schema to a JSON Schema object for tools/list", () => {
    const [first] = listToolDescriptors(buildMcpTools(api(), new Set()));
    // `{ type: "object" }` alone is satisfied by a raw zod schema too — ZodObject
    // exposes its own `.type` getter — so it can't distinguish "converted" from
    // "not converted". `$schema` and a plain-object `properties` only exist on the
    // real z.toJSONSchema() output.
    const schema = first.inputSchema as { $schema?: string; properties?: unknown };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(Object.getPrototypeOf(schema.properties ?? {})).toBe(Object.prototype);
    expect(first.inputSchema).not.toBeInstanceOf(z.ZodType);
    expect(typeof first.description).toBe("string");
    expect(first.description.length).toBeGreaterThan(0);
  });

  it("runs a tool and returns its real result", async () => {
    const tools = buildMcpTools(api(), new Set());
    const out = await callTool(tools, "list_connections", {});
    expect(out).toEqual({ ok: true, result: [{ id: "c1", name: "Prod", host: "h1", team: true }] });
  });

  it("rejects invalid arguments before they reach the vault", async () => {
    const a = api() as unknown as { connections: { create: ReturnType<typeof vi.fn> } };
    a.connections.create = vi.fn();
    const tools = buildMcpTools(a as never, new Set());

    const badAuthType = await callTool(tools, "connection_create", {
      host: "h", port: 22, username: "u", authType: "carrier-pigeon",
    });
    expect(badAuthType.ok).toBe(false);
    expect(a.connections.create).not.toHaveBeenCalled();

    const missingPort = await callTool(tools, "connection_create", {
      host: "h", username: "u", authType: "key",
    });
    expect(missingPort.ok).toBe(false);
    expect(a.connections.create).not.toHaveBeenCalled();
  });

  it("reports an unknown tool rather than throwing", async () => {
    const out = await callTool(buildMcpTools(api(), new Set()), "rm_rf", {});
    expect(out).toEqual({ ok: false, error: 'unknown tool "rm_rf"' });
  });

  it("turns a throwing tool into an error result, so one bad call cannot kill the connection", async () => {
    const broken = api() as unknown as { connections: { list: () => Promise<unknown> } };
    broken.connections.list = () => Promise.reject(new Error("vault locked"));
    const out = await callTool(buildMcpTools(broken as never, new Set()), "list_connections", {});
    expect(out).toEqual({ ok: false, error: "vault locked" });
  });

  it("approves every prompt-risk call without asking: Voltius raises no card, the MCP client is the gate", async () => {
    const seen: Array<{ tool: string; decision: unknown }> = [];
    const original = toolSurface.buildCoreTools;
    vi.spyOn(toolSurface, "buildCoreTools").mockImplementation((ports) =>
      original({
        ...ports,
        approve: async (call) => {
          const decision = await ports.approve(call);
          seen.push({ tool: call.tool, decision });
          return decision;
        },
      }),
    );

    const tools = buildMcpTools(api(), new Set());
    for (const t of tools) await t.execute({}).catch(() => {});

    expect(seen.length).toBeGreaterThan(0);
    for (const { decision } of seen) expect(decision).toMatchObject({ approve: true, via: "granted" });
    vi.restoreAllMocks();
  });
});
