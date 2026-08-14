import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { buildMcpTools, listToolDescriptors, callTool, MCP_TEXT } from "./consumer";
import * as toolSurface from "@voltius/tools";
import { refusal } from "@voltius/tools";
import { registerContributions, clearContributions } from "./contributions";
import { buildDockerMcpTools } from "@/plugins/docker/mcpTools";
import { buildProxmoxMcpTools } from "@/plugins/proxmox/mcpTools";
import { buildMonitoringMcpTools } from "@/plugins/monitoring/mcpTools";
import { buildProcessMcpTools } from "@/plugins/process-manager/mcpTools";

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
  "delete_path",
  "export_objects",
  "folder_create", "folder_delete", "folder_list", "folder_rename",
  "handoff_control",
  "history_search", "host_ping_status",
  "identity_create", "identity_delete", "identity_list",
  "import_objects",
  "key_add_to_host", "key_create", "key_delete", "key_list",
  "known_host_delete", "known_host_list", "known_host_trust",
  "list_connections", "list_files", "list_sessions", "list_shared_sessions",
  "make_dir",
  "marketplace_search", "marketplace_source_add", "marketplace_source_list", "marketplace_source_remove",
  "member_invite", "member_list", "member_remove", "member_set_role",
  "object_copy", "object_move", "open_session",
  "pane_detach", "pane_focus", "pane_list", "pane_split",
  "plugin_configure", "plugin_disable", "plugin_enable", "plugin_install", "plugin_list",
  "plugin_uninstall", "plugin_update",
  "port_forward_create", "port_forward_delete", "port_forward_list", "port_forward_start",
  "port_forward_stop", "port_forward_tunnels", "port_forward_update",
  "read_file", "read_terminal", "rename_path", "run_command",
  "send_keys", "session_move_to_pane",
  "setting_get", "setting_list", "setting_set", "share_session",
  "snippet_create", "snippet_delete", "snippet_list", "snippet_run", "snippet_update",
  "stat_file", "subscription_status", "sync_status",
  "team_list",
  "transfer_cancel", "transfer_file", "transfer_list", "transfer_retry",
  "unshare_session",
  "vault_create", "vault_delete", "vault_key_status", "vault_list", "vault_rename",
  "write_file",
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

  // Contributed descriptions are model-facing too, and the core-only loop above
  // never sees them.
  it("holds for the bundled plugins' contributed descriptions as well", () => {
    const stub = api();
    registerContributions("plugin-docker", buildDockerMcpTools(stub));
    registerContributions("plugin-proxmox", buildProxmoxMcpTools(stub));
    registerContributions("plugin-monitoring", buildMonitoringMcpTools(stub));
    registerContributions("plugin-process-manager", buildProcessMcpTools(stub));
    try {
      const contributed = buildMcpTools(stub, new Set()).filter((t) => t.name.includes("__"));
      expect(contributed).toHaveLength(15);
      for (const t of contributed) {
        expect(t.description.toLowerCase()).not.toContain("prompt");
        expect(t.description.toLowerCase()).not.toContain("agent");
        expect(t.description.toLowerCase()).not.toContain("workbench");
      }
    } finally {
      for (const id of ["plugin-docker", "plugin-proxmox", "plugin-monitoring", "plugin-process-manager"]) {
        clearContributions(id);
      }
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
    // ok:false so the transport marks it isError — a refusal a client reads as
    // a successful call is how "it did nothing" gets reported as "it worked".
    expect(out).toEqual({ ok: false, error: MCP_TEXT.notOwnedError });
  });

  const refusingTool = (result: unknown) => [{
    name: "refuser",
    description: "d",
    schema: z.object({}),
    execute: async () => result,
  }] as unknown as Parameters<typeof callTool>[0];

  it("a marked refusal becomes a failed call, not a successful one", async () => {
    const result = await callTool(
      refusingTool(refusal('Vault "x" still holds 2 connections')),
      "refuser",
      {},
    );
    expect(result).toEqual({ ok: false, error: 'Vault "x" still holds 2 connections' });
  });

  it("makeGate's denial is a failed call too, not a success", async () => {
    const result = await callTool(
      refusingTool(refusal("rejected by user", { reason: "not this host" })),
      "refuser",
      {},
    );
    expect(result).toEqual({ ok: false, error: "rejected by user" });
  });

  it("a refusal carrying a recovery payload stays a refusal", async () => {
    // guardConnectionId's rejection lists the real connections beside `error`.
    // Recognising refusals by which keys sit beside `error` reported this to the
    // client as ok:true — a call that opened nothing, read as one that worked.
    const result = await callTool(
      refusingTool(refusal("no connection with id \"prod\"", { connections: [{ id: "c1" }] })),
      "refuser",
      {},
    );
    expect(result).toEqual({ ok: false, error: 'no connection with id "prod"' });
  });

  it("a result that merely carries an error field alongside data stays a success", async () => {
    const result = await callTool(refusingTool({ error: "partial", items: [1] }), "refuser", {});
    expect(result).toEqual({ ok: true, result: { error: "partial", items: [1] } });
  });

  it("an unmarked bare { error } result is data, not a refusal", async () => {
    // A contributed (third-party) tool does not go through `refusal()`; its
    // payload is its own, and the host does not guess at its meaning.
    const result = await callTool(refusingTool({ error: "container not found" }), "refuser", {});
    expect(result).toEqual({ ok: true, result: { error: "container not found" } });
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
    expect(out).toEqual({ ok: true, result: [{ id: "c1", name: "Prod", host: "h1", vault_id: "personal", folder_id: null, team: true }] });
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

  it("describes the pane verbs without naming an approval that MCP does not do", () => {
    const paneTools = buildMcpTools(api(), new Set()).filter((t) => t.name.startsWith("pane_") || t.name === "session_move_to_pane");
    expect(paneTools).toHaveLength(5);
    for (const t of paneTools) {
      expect(t.description.toLowerCase()).not.toContain("prompt");
      expect(t.description).not.toBe("");
    }
  });
});
