import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { useAgentStore, initAgent, _setDeps } from "./agentStore";

// Structured usage/finishReason shape (LanguageModelV4Usage / V4FinishReason,
// confirmed in node_modules/@ai-sdk/provider/dist/index.d.ts) — mirrors
// agent/loop.test.ts's FINISH_CHUNK verbatim.
const FINISH_CHUNK = {
  type: "finish" as const,
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  },
};

const { mockModel } = vi.hoisted(() => ({ mockModel: { current: null as unknown } }));

vi.mock("../provider/factory", () => ({
  createProvider: vi.fn(async () => mockModel.current),
}));

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

  it("sendMessage streams assistant text into the transcript", async () => {
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "0" },
            { type: "text-delta", id: "0", delta: "Hi" },
            { type: "text-delta", id: "0", delta: " there" },
            { type: "text-end", id: "0" },
            FINISH_CHUNK,
          ],
        }),
      }),
    });
    _setDeps({
      api: fakeApi(),
      profiles: {
        list: async () => [{ id: "p1", providerKind: "anthropic", label: "A", model: "claude-x" }],
        getActiveId: async () => "p1",
        getKey: async () => "sk-test",
      } as never,
      controller: { approve: async () => ({ approve: true }) },
    } as never);

    await useAgentStore.getState().sendMessage("hello");

    const t = useAgentStore.getState().transcript;
    expect(t[0]).toEqual({ kind: "user", text: "hello" });
    expect(t.some((e) => e.kind === "assistant" && e.text.includes("Hi there"))).toBe(true);
    expect(useAgentStore.getState().runStatus).toBe("idle");
  });

  it("starts a fresh assistant transcript entry per text run across a tool-call step, without re-concatenating earlier text", async () => {
    let call = 0;
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => {
        call += 1;
        if (call === 1) {
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: "text-start", id: "0" },
                { type: "text-delta", id: "0", delta: "Checking " },
                { type: "text-end", id: "0" },
                { type: "tool-call", toolCallId: "c1", toolName: "read_terminal", input: JSON.stringify({ sessionId: "s1" }) },
                { type: "finish", finishReason: { unified: "tool-calls" as const, raw: "tool_use" }, usage: FINISH_CHUNK.usage },
              ],
            }),
          };
        }
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start", id: "1" },
              { type: "text-delta", id: "1", delta: "Done." },
              { type: "text-end", id: "1" },
              FINISH_CHUNK,
            ],
          }),
        };
      },
    });
    _setDeps({
      api: { ...(fakeApi() as Record<string, unknown>), terminal: { readSnapshot: vi.fn(() => "buffer") } },
      profiles: {
        list: async () => [{ id: "p1", providerKind: "anthropic", label: "A", model: "claude-x" }],
        getActiveId: async () => "p1",
        getKey: async () => "sk-test",
      } as never,
      controller: { approve: async () => ({ approve: true }) },
    } as never);

    await useAgentStore.getState().sendMessage("hello");

    const t = useAgentStore.getState().transcript;
    const assistantEntries = t.filter((e) => e.kind === "assistant");
    expect(assistantEntries.map((e) => (e as { text: string }).text)).toEqual(["Checking ", "Done."]);
    expect(t.filter((e) => e.kind === "tool")).toHaveLength(2);
    expect(useAgentStore.getState().runStatus).toBe("idle");
  });
});
