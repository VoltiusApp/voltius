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

  it("reads the personal local vault and clamps the page size to 100", async () => {
    const api = createHostPluginAPI("test:clamp", ["audit:read"]);
    await api.audit.query({ perPage: 5000, actions: ["agent.command_run"] });
    expect(fetchLocalAuditLogs).toHaveBeenCalledWith("personal", {
      actions: ["agent.command_run"],
      from: undefined,
      to: undefined,
      page: 1,
      per_page: 100,
    });
  });
});
