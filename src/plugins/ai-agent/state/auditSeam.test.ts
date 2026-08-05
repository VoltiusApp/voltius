import { describe, it, expect, vi, beforeEach } from "vitest";
import { auditAgentAction, setAuditApi } from "./auditSeam";
import { UNKNOWN_SCOPE } from "./scopeDerivation";

const record = vi.fn();

beforeEach(() => {
  record.mockClear();
  setAuditApi({ audit: { record } } as never);
});

describe("auditAgentAction", () => {
  it("passes a connection scope through as the connection id, metadata unchanged", () => {
    auditAgentAction("c1", "agent.command_run", { tool: "run_command" }, { command: "uptime" });
    expect(record).toHaveBeenCalledWith(
      "c1",
      "agent.command_run",
      { tool: "run_command" },
      { command: "uptime" },
    );
  });

  it('sends a null connection id for "local", keeping the scope in metadata', () => {
    auditAgentAction("local", "agent.mode_changed", { from: "ask", to: "auto" });
    expect(record).toHaveBeenCalledWith(
      null,
      "agent.mode_changed",
      { from: "ask", to: "auto", scope: "local" },
      undefined,
    );
  });

  it("sends a null connection id for the unknown scope, distinguishable from local", () => {
    auditAgentAction(UNKNOWN_SCOPE, "agent.command_run", { tool: "run_command" });
    expect(record.mock.calls[0][0]).toBeNull();
    expect(record.mock.calls[0][2]).toEqual({ tool: "run_command", scope: UNKNOWN_SCOPE });
  });

  it("omits absent metadata rather than inventing an object for a connection scope", () => {
    auditAgentAction("c1", "agent.session_closed");
    expect(record).toHaveBeenCalledWith("c1", "agent.session_closed", undefined, undefined);
  });

  it("is a no-op once the api is released, so a torn-down plugin records nothing", () => {
    setAuditApi(null);
    auditAgentAction("c1", "agent.command_run", { tool: "run_command" });
    expect(record).not.toHaveBeenCalled();
  });
});
