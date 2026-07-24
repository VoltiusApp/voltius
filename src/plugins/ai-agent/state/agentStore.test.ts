import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { useAgentStore, initAgent, _setDeps, isAbortError, shutdownAgent, getAgentDeps } from "./agentStore";
import { buildTools } from "../tools/registry";

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

// Spied, not stubbed: wraps the real runAgent so the actual streamText loop
// still drives the transcript (other tests depend on that), while letting us
// assert on the ctx it was called with.
vi.mock("../agent/loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent/loop")>();
  return { ...actual, runAgent: vi.fn(actual.runAgent) };
});
import { runAgent } from "../agent/loop";

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

  it("addAllowlist refuses to persist a key containing a shell metacharacter (defense in depth)", async () => {
    const persisted: Record<string, unknown> = {};
    await initAgent(fakeApi(persisted));
    useAgentStore.getState().addAllowlist({ host: "web-01", key: "df -h !sudo" });
    expect(useAgentStore.getState().hasAllowlist({ host: "web-01", key: "df -h !sudo" })).toBe(false);
    expect(useAgentStore.getState().allowlist).toEqual([]);
    expect(persisted.allowlist).toBeUndefined();
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

  it("sendMessage is a no-op while a run is already streaming (single-flight guard)", async () => {
    // Wire real deps + a model that WOULD stream text if the guard didn't
    // block it, so this test actually proves the guard prevents a second
    // run from starting (rather than passing vacuously because deps/model
    // are unset).
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "0" },
            { type: "text-delta", id: "0", delta: "should not run" },
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
    useAgentStore.setState({
      runStatus: "streaming",
      transcript: [{ kind: "user", text: "first" }],
      messages: [{ role: "user", content: "first" }],
    });

    await useAgentStore.getState().sendMessage("second");

    expect(useAgentStore.getState().transcript).toEqual([{ kind: "user", text: "first" }]);
    expect(useAgentStore.getState().messages).toEqual([{ role: "user", content: "first" }]);
    expect(useAgentStore.getState().runStatus).toBe("streaming");
  });

  it("sendMessage ends in error state with a message when the model stream errors", async () => {
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [{ type: "error", error: new Error("provider exploded") }],
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

    expect(useAgentStore.getState().runStatus).toBe("error");
    expect(useAgentStore.getState().errorText).toBe("provider exploded");
  });

  it("sendMessage's catch branch still yields runStatus 'error' for a genuine (non-abort) failure", async () => {
    // Drives the *catch* block directly (createProvider rejects before any
    // abortController exists) so this exercises the same code path the
    // abort-detection branch lives in, not the separate onError-chunk path
    // covered above.
    const { createProvider } = await import("../provider/factory");
    (createProvider as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
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

    expect(useAgentStore.getState().runStatus).toBe("error");
    expect(useAgentStore.getState().errorText).toBe("boom");
  });

  it("stop() during a run resolves to idle, not error (a deliberate Stop is not a failure)", async () => {
    // Regression test for the Stop-renders-as-error bug: without the
    // isAbortError branch in sendMessage's catch, this assertion fails
    // because runStatus lands on "error" with errorText "This operation
    // was aborted" (the DOMException message the AI SDK's streamText
    // rejects `responseMessages` with once abortSignal fires).
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunkDelayInMs: 20,
          chunks: [
            { type: "text-start", id: "0" },
            { type: "text-delta", id: "0", delta: "Hi" },
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

    const sendPromise = useAgentStore.getState().sendMessage("hello");
    await vi.waitFor(() => expect(useAgentStore.getState().runStatus).toBe("streaming"));
    useAgentStore.getState().stop();
    await sendPromise;

    expect(useAgentStore.getState().runStatus).toBe("idle");
    expect(useAgentStore.getState().errorText).toBeNull();
  });

  it("hands runAgent the SAME owned-session Set across two turns, and initAgent resets it to a fresh one", async () => {
    (runAgent as unknown as ReturnType<typeof vi.fn>).mockClear();
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "0" },
            { type: "text-delta", id: "0", delta: "ok" },
            { type: "text-end", id: "0" },
            FINISH_CHUNK,
          ],
        }),
      }),
    });
    const fakeDeps = {
      api: fakeApi(),
      profiles: {
        list: async () => [{ id: "p1", providerKind: "anthropic", label: "A", model: "claude-x" }],
        getActiveId: async () => "p1",
        getKey: async () => "sk-test",
      } as never,
      controller: { approve: async () => ({ approve: true }) },
    } as never;
    _setDeps(fakeDeps);

    await useAgentStore.getState().sendMessage("turn one");
    await useAgentStore.getState().sendMessage("turn two");

    const calls = (runAgent as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    const firstOwned = (calls[0][0] as { ctx: { owned: Set<string> } }).ctx.owned;
    const secondOwned = (calls[1][0] as { ctx: { owned: Set<string> } }).ctx.owned;
    expect(secondOwned).toBe(firstOwned);

    // A fresh activation must not carry over the previous conversation's set.
    await initAgent(fakeApi());
    _setDeps(fakeDeps);
    await useAgentStore.getState().sendMessage("turn three, new conversation");
    const thirdCalls = (runAgent as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const thirdOwned = (thirdCalls[thirdCalls.length - 1][0] as { ctx: { owned: Set<string> } }).ctx.owned;
    expect(thirdOwned).not.toBe(firstOwned);
  });

  it("shutdownAgent aborts an in-flight run, rejects+clears pending approvals, resets runStatus, and clears deps — and a subsequent initAgent + sendMessage isn't bricked", async () => {
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunkDelayInMs: 20,
          chunks: [
            { type: "text-start", id: "0" },
            { type: "text-delta", id: "0", delta: "Hi" },
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

    const pendingResolve = vi.fn();
    useAgentStore.setState({
      pendingApprovals: [{ id: "p1", tool: "run_command", args: {}, host: "h", allowlistKey: "ls", resolve: pendingResolve }],
    });

    const sendPromise = useAgentStore.getState().sendMessage("hello");
    await vi.waitFor(() => expect(useAgentStore.getState().runStatus).toBe("streaming"));

    shutdownAgent();

    // Reset is synchronous — doesn't wait on the aborted run's own promise.
    expect(useAgentStore.getState().runStatus).toBe("idle");
    expect(useAgentStore.getState().errorText).toBeNull();
    expect(useAgentStore.getState().pendingApprovals).toHaveLength(0);
    expect(pendingResolve).toHaveBeenCalledWith({ approve: false, reason: "aborted" });
    expect(getAgentDeps()).toBeNull();

    await sendPromise; // let the aborted run's own catch/finally settle before reusing the store

    // Re-enable: without initAgent resetting runStatus, the single-flight
    // guard (`if (get().runStatus === "streaming") return;`) would brick the
    // composer forever, since teardown alone can't guarantee the previous
    // run's own catch handler already reset it.
    await initAgent(fakeApi());
    _setDeps({
      api: fakeApi(),
      profiles: {
        list: async () => [{ id: "p1", providerKind: "anthropic", label: "A", model: "claude-x" }],
        getActiveId: async () => "p1",
        getKey: async () => "sk-test",
      } as never,
      controller: { approve: async () => ({ approve: true }) },
    } as never);

    await useAgentStore.getState().sendMessage("hello again");
    expect(useAgentStore.getState().runStatus).toBe("idle");
    expect(useAgentStore.getState().transcript.some((e) => e.kind === "assistant" && e.text.includes("Hi"))).toBe(true);
  });

  // Regression test 1 (brief item I1, "the auto-mode race"): in `auto` mode,
  // approve() used to return {approve:true} unconditionally with no abort
  // check at all — a tool dispatched at the moment of Stop just ran, with no
  // card and no trace. Drives a REAL tool from buildTools through the REAL
  // controller (not a stub) so this proves the underlying api call is never
  // reached, not just that approve() returns the right shape.
  it("mode=auto: a tool call in flight after stop() is refused by the real controller and the underlying api call never fires", async () => {
    const openSpy = vi.fn(async () => "sess-1");
    const api = {
      ...(fakeApi() as object),
      sessions: { list: () => [], open: openSpy },
      connections: { list: async () => [{ id: "c1", name: "srv", host: "web-01" }] },
    };
    await initAgent(api as never);
    useAgentStore.getState().setMode("auto");
    useAgentStore.getState().stop(); // marks the current run generation aborted, nothing else in flight

    const ctx = { api: api as never, approve: getAgentDeps()!.controller.approve, owned: new Set<string>() };
    const tools = buildTools(ctx);
    const openSession = tools.find((t) => t.name === "open_session")!;

    const res = await openSession.execute({ connectionId: "c1" });
    expect(res).toEqual({ error: "rejected by user", reason: "aborted" });
    expect(openSpy).not.toHaveBeenCalled();
  });

  // Regression test 3 (brief item I2): an orphan card from a dead activation
  // must not survive into a re-enabled drawer, where approving it would
  // resolve a tool closure holding the stale PluginAPI that _setDeps(null)
  // was added to prevent. initAgent must reject+clear pendingApprovals for
  // symmetry with shutdownAgent, regardless of how teardown was (or wasn't)
  // run beforehand.
  it("initAgent rejects and clears pending approvals left over from a previous activation", async () => {
    const resolve = vi.fn();
    useAgentStore.setState({
      pendingApprovals: [{ id: "stale-1", tool: "run_command", args: {}, host: "h", allowlistKey: "ls", resolve }],
    });

    await initAgent(fakeApi());

    expect(resolve).toHaveBeenCalledWith({ approve: false, reason: "aborted" });
    expect(useAgentStore.getState().pendingApprovals).toHaveLength(0);
  });

  it("stop() rejects a pending approval so the parked tool sees the rejection and never executes", async () => {
    const openSpy = vi.fn(async () => "sess-1");
    const api = {
      ...(fakeApi() as object),
      sessions: { list: () => [], open: openSpy },
      connections: { list: async () => [{ id: "c1", name: "srv", host: "web-01" }] },
    };
    await initAgent(api as never);

    const ctx = { api: api as never, approve: getAgentDeps()!.controller.approve, owned: new Set<string>() };
    const tools = buildTools(ctx);
    const openSession = tools.find((t) => t.name === "open_session")!;

    const execPromise = openSession.execute({ connectionId: "c1" });
    await vi.waitFor(() => expect(useAgentStore.getState().pendingApprovals).toHaveLength(1));

    useAgentStore.getState().stop();

    const res = await execPromise;
    expect(res).toEqual({ error: "rejected by user", reason: "aborted" });
    expect(useAgentStore.getState().pendingApprovals).toHaveLength(0);
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe("isAbortError", () => {
  it("is true for a DOMException named AbortError", () => {
    expect(isAbortError(new DOMException("This operation was aborted", "AbortError"))).toBe(true);
  });

  it("is true for a plain Error named AbortError", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(isAbortError(err)).toBe(true);
  });

  it("is true when the run's AbortSignal is aborted, regardless of the error's shape", () => {
    const ac = new AbortController();
    ac.abort();
    expect(isAbortError(new Error("some unrelated network error"), ac.signal)).toBe(true);
  });

  it("is false for a genuine error with a non-aborted (or absent) signal", () => {
    const ac = new AbortController();
    expect(isAbortError(new Error("provider exploded"), ac.signal)).toBe(false);
    expect(isAbortError(new Error("provider exploded"))).toBe(false);
  });
});
