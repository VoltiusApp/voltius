import { describe, it, expect, vi, beforeEach } from "vitest";

const reportAgentAuditEvent = vi.fn(
  (_context: Record<string, unknown>, _action: string, _opts: Record<string, unknown>) => {},
);
const connections: Array<Record<string, unknown>> = [];
const teamConnections: Record<string, Array<Record<string, unknown>>> = {};
const teams: Array<{ id: string }> = [];
const vaults: Array<{ id: string; teamId?: string }> = [];

vi.mock("@/services/auditReporter", () => ({ reportAgentAuditEvent }));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: { getState: () => ({ connections, teamConnections }) },
}));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: { getState: () => ({ teams }) } }));
vi.mock("@/stores/vaultStore", () => ({ useVaultStore: { getState: () => ({ vaults }) } }));

const { auditAgentAction } = await import("./auditSeam");

beforeEach(() => {
  reportAgentAuditEvent.mockClear();
  connections.length = 0;
  for (const key of Object.keys(teamConnections)) delete teamConnections[key];
  teams.length = 0;
  vaults.length = 0;
});

describe("auditAgentAction", () => {
  it("resolves a team context for a connection in a team vault", () => {
    // Team connections live ONLY in `teamConnections`, keyed by team id —
    // never in `connections` (personal-only). This is the real store shape.
    vaults.push({ id: "tv1", teamId: "t1" });
    teamConnections.t1 = [
      { id: "c1", name: "prod-db-1", username: "root", host: "h", port: 22, vault_id: "tv1" },
    ];

    auditAgentAction("c1", "agent.command_run", { tool: "run_command" });

    const [context] = reportAgentAuditEvent.mock.calls[0];
    expect(context).toEqual({ kind: "team", teamId: "t1", vaultId: "tv1" });
  });

  it("resolves target_name for a connection found only in teamConnections", () => {
    vaults.push({ id: "tv1", teamId: "t1" });
    teamConnections.t1 = [
      { id: "c1", name: "prod-db-1", username: "root", host: "h", port: 22, vault_id: "tv1" },
    ];

    auditAgentAction("c1", "agent.command_run", { tool: "run_command" });

    expect(reportAgentAuditEvent.mock.calls[0][2].target_name).toBe("prod-db-1");
  });

  it("PRIVACY: a personal connection resolves local, so nothing is POSTed", () => {
    // The user is on a team, but this host is theirs. It must not reach the
    // team server just because they happen to be a member of one.
    vaults.push({ id: "tv1", teamId: "t1" });
    teams.push({ id: "t1" });
    connections.push({ id: "c2", name: "my-laptop", username: "me", host: "h", port: 22, vault_id: "personal" });

    auditAgentAction("c2", "agent.command_run", { tool: "run_command" });

    const [context] = reportAgentAuditEvent.mock.calls[0];
    expect(context.kind).toBe("local");
  });

  it("fails closed to local for UNKNOWN_SCOPE", () => {
    auditAgentAction("unknown connection", "agent.command_run", { tool: "run_command" });
    expect(reportAgentAuditEvent.mock.calls[0][0]).toEqual({ kind: "local", vaultId: "personal" });
  });

  it("fails closed to local for the literal local scope", () => {
    auditAgentAction("local", "agent.mode_changed", { from: "ask", to: "auto" });
    expect(reportAgentAuditEvent.mock.calls[0][0]).toEqual({ kind: "local", vaultId: "personal" });
  });

  it("fails closed to local for a deleted connection id", () => {
    auditAgentAction("gone", "agent.command_run", { tool: "run_command" });
    expect(reportAgentAuditEvent.mock.calls[0][0]).toEqual({ kind: "local", vaultId: "personal" });
  });

  it("names a connection by its name, falling back to the endpoint", () => {
    connections.push({ id: "c1", name: "  ", username: "root", host: "10.0.0.5", port: 2222, vault_id: "personal" });
    auditAgentAction("c1", "agent.session_opened", { tool: "open_session" });
    expect(reportAgentAuditEvent.mock.calls[0][2].target_name).toBe("root@10.0.0.5:2222");
  });

  it("passes target fields and both metadata channels through", () => {
    connections.push({ id: "c1", name: "prod", username: "root", host: "h", port: 22, vault_id: "personal" });
    auditAgentAction("c1", "agent.command_run", { tool: "run_command" }, { command: "uptime" });

    const [, action, opts] = reportAgentAuditEvent.mock.calls[0];
    expect(action).toBe("agent.command_run");
    expect(opts).toEqual({
      target_type: "ai_agent",
      target_id: "c1",
      target_name: "prod",
      metadata: { tool: "run_command" },
      localMetadata: { command: "uptime" },
    });
  });
});
