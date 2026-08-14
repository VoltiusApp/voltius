import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHostPluginAPI } from "./runtime";

const fetchLocalAuditLogs = vi.fn();
vi.mock("@/services/localAuditService", () => ({
  fetchLocalAuditLogs: (...args: unknown[]) => fetchLocalAuditLogs(...args),
  reportLocalClientEvent: vi.fn(),
}));

const ROW = {
  id: 7,
  team_id: "local",
  vault_id: "personal",
  actor_id: "local-user",
  actor_name: "You",
  action: "agent.object_created",
  source: "client",
  target_type: "plugin",
  target_id: "mcp",
  target_name: "local",
  metadata: { via: "mcp", objectType: "key" },
  ip_address: null,
  created_at: "2026-08-09T14:02:11Z",
};

describe("api.audit.query", () => {
  beforeEach(() => {
    fetchLocalAuditLogs.mockReset();
    fetchLocalAuditLogs.mockResolvedValue({ logs: [ROW], total: 1 });
  });

  it("throws when the plugin did not declare audit:read", async () => {
    const api = createHostPluginAPI("test:no-perm", ["audit"]);
    await expect(api.audit.query({})).rejects.toThrow(/audit:read/);
  });

  it("projects rows down to the PluginAuditRow contract", async () => {
    const api = createHostPluginAPI("test:projection", ["audit:read"]);
    const { logs, total } = await api.audit.query({});
    expect(total).toBe(1);
    expect(logs[0]).toEqual({
      action: "agent.object_created",
      actor_name: "You",
      source: "client",
      target_type: "plugin",
      target_id: "mcp",
      target_name: "local",
      metadata: { via: "mcp", objectType: "key" },
      created_at: "2026-08-09T14:02:11Z",
    });
  });

  it("strips the metadata keys that reached the row through localMetadata", async () => {
    fetchLocalAuditLogs.mockResolvedValue({
      logs: [{
        ...ROW,
        action: "agent.command_run",
        metadata: {
          via: "mcp",
          tool: "run_command",
          command: "cat /etc/shadow",
          command_truncated: true,
          args: JSON.stringify({ path: "/home/me/.ssh/id_ed25519" }),
          args_truncated: true,
          localMetadata_dropped: true,
        },
      }],
      total: 1,
    });
    const api = createHostPluginAPI("test:local-only", ["audit:read"]);
    const { logs } = await api.audit.query({});
    expect(logs[0].metadata).toEqual({ via: "mcp", tool: "run_command" });
  });

  // A key stream can carry a password typed at a prompt the terminal never
  // echoes, so read_terminal cannot see it — audit.query must not be the way
  // back to it either.
  it("strips send_keys' key tokens, which the terminal buffer never showed", async () => {
    fetchLocalAuditLogs.mockResolvedValue({
      logs: [{
        ...ROW,
        action: "agent.keys_sent",
        metadata: {
          via: "mcp",
          tool: "send_keys",
          keys: ["lit:hunter2", "Enter"],
          keys_truncated: true,
          localMetadata_dropped: true,
        },
      }],
      total: 1,
    });
    const api = createHostPluginAPI("test:local-only", ["audit:read"]);
    const { logs } = await api.audit.query({});
    expect(logs[0].metadata).toEqual({ via: "mcp", tool: "send_keys" });
    expect(JSON.stringify(logs)).not.toContain("hunter2");
  });

  it("reads the personal local vault and clamps the page size to 100", async () => {
    const api = createHostPluginAPI("test:clamp", ["audit:read"]);
    await api.audit.query({ perPage: 5000, actions: ["agent.command_run"] });
    expect(fetchLocalAuditLogs).toHaveBeenCalledWith("personal", {
      actions: ["agent.command_run"],
      actor_id: undefined,
      from: undefined,
      to: undefined,
      page: 1,
      per_page: 100,
    });
  });

  it("forwards actorId to the local sink too, not only the team one", async () => {
    const api = createHostPluginAPI("test:local-actor", ["audit:read"]);
    await api.audit.query({ actorId: "user-3" });
    expect(fetchLocalAuditLogs).toHaveBeenCalledWith("personal", {
      actions: undefined,
      actor_id: "user-3",
      from: undefined,
      to: undefined,
      page: 1,
      per_page: 50,
    });
  });
});
