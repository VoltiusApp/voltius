import { describe, test, expect, vi, beforeEach } from "vitest";

const reportClientEvent = vi.fn().mockResolvedValue(undefined);
const reportLocalClientEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/services/auditService", () => ({ reportClientEvent }));
vi.mock("@/services/localAuditService", () => ({ reportLocalClientEvent }));

const { reportPluginAuditEvent, localSinkVaultId } = await import("@/services/auditReporter");

beforeEach(() => {
  reportClientEvent.mockClear();
  reportLocalClientEvent.mockClear();
});

describe("localSinkVaultId", () => {
  test("uses the vault id for a local context", () => {
    expect(localSinkVaultId({ kind: "local", vaultId: "personal" })).toBe("personal");
  });

  test("falls back to personal for a team context", () => {
    expect(localSinkVaultId({ kind: "team", teamId: "t1", vaultId: "v1" })).toBe("personal");
  });
});

describe("reportPluginAuditEvent", () => {
  test("a local context writes only the local sink", () => {
    reportPluginAuditEvent({ kind: "local", vaultId: "personal" }, "agent.command_run");
    expect(reportLocalClientEvent).toHaveBeenCalledTimes(1);
    expect(reportClientEvent).not.toHaveBeenCalled();
  });

  test("a team context writes local AND posts the team", () => {
    reportPluginAuditEvent({ kind: "team", teamId: "t1", vaultId: "v1" }, "agent.command_run");
    expect(reportLocalClientEvent).toHaveBeenCalledTimes(1);
    expect(reportClientEvent).toHaveBeenCalledTimes(1);
    expect(reportClientEvent.mock.calls[0][0]).toBe("t1");
  });

  test("localMetadata reaches the local sink and never the wire", () => {
    reportPluginAuditEvent(
      { kind: "team", teamId: "t1" },
      "agent.command_run",
      { metadata: { shared: 1 } },
    );
    reportPluginAuditEvent(
      { kind: "team", teamId: "t1" },
      "agent.command_run",
      { metadata: { shared: 1 }, localMetadata: { command: "rm -rf /" } },
    );

    const local = reportLocalClientEvent.mock.calls[1][1] as { metadata: Record<string, unknown> };
    const team = reportClientEvent.mock.calls[1][1] as { metadata?: Record<string, unknown> };
    expect(local.metadata).toEqual({ shared: 1, command: "rm -rf /" });
    expect(team.metadata).toEqual({ shared: 1 });
  });

  test("a caller-supplied localMetadata.plugin_id does not override the stamped one", () => {
    reportPluginAuditEvent(
      { kind: "local", vaultId: "personal" },
      "agent.command_run",
      { metadata: { plugin_id: "agent" }, localMetadata: { plugin_id: "other-plugin" } },
    );
    const local = reportLocalClientEvent.mock.calls[0][1] as { metadata: Record<string, unknown> };
    expect(local.metadata.plugin_id).toBe("agent");
  });

  test("a team POST failure does not reject", () => {
    reportClientEvent.mockReturnValueOnce(Promise.reject(new Error("400")));
    expect(() =>
      reportPluginAuditEvent({ kind: "team", teamId: "t1" }, "agent.command_run"),
    ).not.toThrow();
  });
});
