import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAgentStore, initAgent } from "./agentStore";

function fakeApi(store: Record<string, unknown> = {}) {
  return {
    storage: {
      get: vi.fn(async (k: string) => (k in store ? store[k] : null)),
      set: vi.fn(async (k: string, v: unknown) => { store[k] = v; }),
      delete: vi.fn(),
    },
    keychain: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    sessions: { list: () => [] },
    connections: { list: async () => [] },
  } as never;
}

describe("agentStore", () => {
  beforeEach(() => {
    useAgentStore.setState({
      mode: "ask", allowlist: [], pendingApprovals: [], runStatus: "idle",
      errorText: null, transcript: [], messages: [],
    });
  });

  it("initAgent loads persisted mode + allowlist", async () => {
    await initAgent(fakeApi({ agentMode: "auto", allowlist: [{ host: "h", key: "ls" }] }));
    expect(useAgentStore.getState().mode).toBe("auto");
    expect(useAgentStore.getState().allowlist).toEqual([{ host: "h", key: "ls" }]);
  });

  it("cycleMode goes plan → ask → auto → plan", () => {
    const { setMode, cycleMode } = useAgentStore.getState();
    setMode("plan"); cycleMode();
    expect(useAgentStore.getState().mode).toBe("ask");
    cycleMode(); expect(useAgentStore.getState().mode).toBe("auto");
    cycleMode(); expect(useAgentStore.getState().mode).toBe("plan");
  });

  it("addAllowlist persists and hasAllowlist matches", async () => {
    const persisted: Record<string, unknown> = {};
    await initAgent(fakeApi(persisted));
    useAgentStore.getState().addAllowlist({ host: "web-01", key: "apt" });
    expect(useAgentStore.getState().hasAllowlist({ host: "web-01", key: "apt" })).toBe(true);
    await vi.waitFor(() => expect(persisted.allowlist).toEqual([{ host: "web-01", key: "apt" }]));
  });

  it("resolveApproval calls the stored resolver and removes the record", () => {
    const resolve = vi.fn();
    useAgentStore.setState({
      pendingApprovals: [{ id: "a1", tool: "run_command", args: {}, host: "h", allowlistKey: "ls", resolve }],
    });
    useAgentStore.getState().resolveApproval("a1", { approve: true });
    expect(resolve).toHaveBeenCalledWith({ approve: true });
    expect(useAgentStore.getState().pendingApprovals).toHaveLength(0);
  });
});
