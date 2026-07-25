import { describe, it, expect, vi, beforeEach } from "vitest";

const reportClientEvent = vi.fn(async (_teamId: string, _event: Record<string, unknown>) => {});
const reportLocalClientEvent = vi.fn(async (_vaultId: string, _event: Record<string, unknown>) => {});

vi.mock("@/services/auditService", () => ({ reportClientEvent }));
vi.mock("@/services/localAuditService", () => ({ reportLocalClientEvent }));

const { reportAgentAuditEvent, localSinkVaultId } = await import("./auditReporter");

beforeEach(() => {
  reportClientEvent.mockClear();
  reportLocalClientEvent.mockClear();
});

describe("localSinkVaultId", () => {
  it("uses the vault's own id for a local context", () => {
    expect(localSinkVaultId({ kind: "local", vaultId: "v-uuid" })).toBe("v-uuid");
  });

  it("falls back to personal for a team context", () => {
    // auditStore.fetchLogs dispatches on context.kind, so a local row written
    // under a TEAM vault id would be written and never read back. "personal"
    // is the one local vault vaultStore.removeVault refuses to delete.
    expect(localSinkVaultId({ kind: "team", teamId: "t1", vaultId: "tv1" })).toBe("personal");
  });
});

describe("reportAgentAuditEvent", () => {
  it("writes locally and does not POST for a local context", () => {
    reportAgentAuditEvent({ kind: "local", vaultId: "v1" }, "agent.command_run", {
      target_id: "c1",
      metadata: { tool: "run_command", approval: "prompted" },
      localMetadata: { command: "systemctl status nginx" },
    });

    expect(reportLocalClientEvent).toHaveBeenCalledTimes(1);
    expect(reportClientEvent).not.toHaveBeenCalled();
  });

  it("writes locally AND POSTs for a team context", () => {
    reportAgentAuditEvent({ kind: "team", teamId: "t1", vaultId: "tv1" }, "agent.command_run", {
      target_id: "c1",
      metadata: { tool: "run_command", approval: "granted" },
    });

    expect(reportLocalClientEvent).toHaveBeenCalledTimes(1);
    expect(reportClientEvent).toHaveBeenCalledTimes(1);
  });

  it("PRIVACY: localMetadata never reaches the wire", () => {
    reportAgentAuditEvent({ kind: "team", teamId: "t1", vaultId: "tv1" }, "agent.command_run", {
      target_type: "ai_agent",
      target_id: "c1",
      target_name: "prod-db-1",
      metadata: { tool: "run_command", approval: "prompted" },
      localMetadata: { command: "mysql -pHunter2" },
    });

    // Assert the EXACT posted object. A subset assertion (objectContaining)
    // passes when an extra field leaks in, which is the whole failure mode
    // this test exists to catch.
    const [teamId, event] = reportClientEvent.mock.calls[0];
    expect(teamId).toBe("t1");
    expect(event).toEqual({
      action: "agent.command_run",
      target_type: "ai_agent",
      target_id: "c1",
      target_name: "prod-db-1",
      metadata: { tool: "run_command", approval: "prompted" },
      vault_id: "tv1",
      occurred_at: expect.any(String),
    });
    expect(JSON.stringify(event)).not.toContain("Hunter2");
  });

  it("merges localMetadata into the LOCAL record only", () => {
    reportAgentAuditEvent({ kind: "team", teamId: "t1", vaultId: "tv1" }, "agent.command_run", {
      target_id: "c1",
      metadata: { tool: "run_command" },
      localMetadata: { command: "whoami" },
    });

    const [vaultId, event] = reportLocalClientEvent.mock.calls[0];
    expect(vaultId).toBe("personal");
    expect(event.metadata).toEqual({ tool: "run_command", command: "whoami" });
  });

  it("omits metadata entirely when there is none", () => {
    reportAgentAuditEvent({ kind: "local", vaultId: "v1" }, "agent.session_closed", {
      target_id: "c1",
    });

    expect(reportLocalClientEvent.mock.calls[0][1].metadata).toBeUndefined();
  });
});
