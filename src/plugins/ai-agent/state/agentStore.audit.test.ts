import { describe, it, expect, vi, beforeEach } from "vitest";

const auditAgentAction = vi.fn();
vi.mock("./auditSeam", () => ({ auditAgentAction }));

const { useAgentStore } = await import("./agentStore");

const entry = { scope: "c1", tool: "run_command", grain: "exact", key: "uptime" } as const;

beforeEach(() => {
  auditAgentAction.mockClear();
  useAgentStore.setState({ allowlist: [], mode: "ask", pendingApprovals: [] });
});

describe("grant auditing", () => {
  it("records a created grant with the command local-only", () => {
    useAgentStore.getState().addAllowlist({ ...entry });
    expect(auditAgentAction).toHaveBeenCalledWith(
      "c1", "agent.grant_created", { tool: "run_command", grain: "exact" }, { command: "uptime" },
    );
  });

  it("does NOT record a duplicate grant", () => {
    useAgentStore.getState().addAllowlist({ ...entry });
    auditAgentAction.mockClear();
    useAgentStore.getState().addAllowlist({ ...entry });
    expect(auditAgentAction).not.toHaveBeenCalled();
  });

  it("does NOT record a malformed grant the store rejects", () => {
    useAgentStore.getState().addAllowlist({ scope: "", tool: "", grain: "exact", key: "" } as never);
    expect(auditAgentAction).not.toHaveBeenCalled();
  });

  it("records a revoked grant", () => {
    useAgentStore.getState().addAllowlist({ ...entry });
    auditAgentAction.mockClear();
    useAgentStore.getState().revokeAllowlist({ ...entry });
    expect(auditAgentAction).toHaveBeenCalledWith(
      "c1", "agent.grant_revoked", { tool: "run_command", grain: "exact" }, { command: "uptime" },
    );
  });

  it("does NOT record revoking a grant that was not there", () => {
    useAgentStore.getState().revokeAllowlist({ ...entry });
    expect(auditAgentAction).not.toHaveBeenCalled();
  });

  it("records a bulk revoke with a count and no command", () => {
    useAgentStore.getState().addAllowlist({ ...entry });
    useAgentStore.getState().addAllowlist({ ...entry, key: "whoami" });
    auditAgentAction.mockClear();
    useAgentStore.getState().revokeAllAllowlist();
    expect(auditAgentAction).toHaveBeenCalledWith("local", "agent.grant_revoked", { bulk: true, count: 2 });
  });

  it("does NOT record a bulk revoke of an empty allowlist", () => {
    useAgentStore.getState().revokeAllAllowlist();
    expect(auditAgentAction).not.toHaveBeenCalled();
  });
});

describe("mode auditing", () => {
  it("records a mode change", () => {
    useAgentStore.getState().setMode("auto");
    expect(auditAgentAction).toHaveBeenCalledWith("local", "agent.mode_changed", { from: "ask", to: "auto" });
  });

  it("does NOT record a no-op mode set", () => {
    useAgentStore.getState().setMode("ask");
    expect(auditAgentAction).not.toHaveBeenCalled();
  });

  it("records exactly one event for a cycle", () => {
    useAgentStore.getState().cycleMode();
    expect(auditAgentAction).toHaveBeenCalledTimes(1);
    expect(auditAgentAction).toHaveBeenCalledWith("local", "agent.mode_changed", { from: "ask", to: "auto" });
  });
});

describe("denial auditing", () => {
  function pend() {
    const resolve = vi.fn();
    useAgentStore.setState({
      pendingApprovals: [{
        id: "a1", tool: "run_command", args: { command: "rm -rf /tmp/x" },
        scope: "c1", grants: [], resolve,
      }],
    });
    return resolve;
  }

  it("records a user denial with the reason local-only", () => {
    pend();
    useAgentStore.getState().resolveApproval("a1", { approve: false, reason: "too risky" });
    expect(auditAgentAction).toHaveBeenCalledWith(
      "c1", "agent.action_denied", { tool: "run_command" },
      { command: "rm -rf /tmp/x", reason: "too risky" },
    );
  });

  it("does NOT record an approval as a denial", () => {
    pend();
    useAgentStore.getState().resolveApproval("a1", { approve: true, scope: "c1", via: "prompted" });
    expect(auditAgentAction).not.toHaveBeenCalled();
  });

  it("does NOT record cancels routed through _rejectAllPending", () => {
    // "aborted"/"superseded" are cancels, not the user refusing a proposal.
    pend();
    useAgentStore.getState()._rejectAllPending("aborted");
    expect(auditAgentAction).not.toHaveBeenCalled();
  });
});
