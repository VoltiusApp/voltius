import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import {
  useAgentStore, initAgent, _setDeps, isAbortError, shutdownAgent, getAgentDeps, _currentRunGeneration,
  type AllowlistEntry, type Mode,
} from "./agentStore";
import { buildTools } from "../tools/registry";
import type { AgentContext } from "../tools/registry";

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

function profilesStub() {
  return {
    list: async () => [{ id: "p1", providerKind: "anthropic", label: "A", model: "claude-x" }],
    getActiveId: async () => "p1",
    getKey: async () => "sk-test",
  } as never;
}

function approveAllController() {
  return { approve: async () => ({ approve: true as const, scope: "c1", via: "granted" as const }) };
}

describe("agentStore", () => {
  beforeEach(() => {
    useAgentStore.setState({
      mode: "ask", allowlist: [], pendingApprovals: [], runStatus: "idle",
      errorText: null, transcript: [], messages: [],
    });
  });

  it("initAgent loads persisted mode + allowlist", async () => {
    const entry: AllowlistEntry = { scope: "h", tool: "run_command", grain: "exact", key: "ls -la" };
    await initAgent(fakeApi({ agentMode: "auto", allowlist: [entry] }));
    expect(useAgentStore.getState().mode).toBe("auto");
    expect(useAgentStore.getState().allowlist).toEqual([entry]);
  });

  it("initAgent restores a persisted conversation", async () => {
    const stored = {
      v: 1,
      transcript: [{ kind: "user", text: "earlier" }],
      messages: [{ role: "user", content: "earlier" }],
    };
    await initAgent(fakeApi({ conversation: stored }));
    expect(useAgentStore.getState().transcript).toEqual([{ kind: "user", text: "earlier" }]);
    expect(useAgentStore.getState().messages).toEqual([{ role: "user", content: "earlier" }]);
  });

  it("initAgent starts empty on malformed persisted data without wiping a live transcript", async () => {
    useAgentStore.setState({ transcript: [{ kind: "user", text: "kept" }], messages: [{ role: "user", content: "kept" }] });
    await initAgent(fakeApi({ conversation: { v: 99, transcript: [], messages: [] } }));
    expect(useAgentStore.getState().transcript).toEqual([{ kind: "user", text: "kept" }]);
  });

  it("_persistConversation writes the versioned payload through storage", () => {
    const store: Record<string, unknown> = {};
    _setDeps({ api: fakeApi(store), profiles: {} as never, controller: {} as never });
    useAgentStore.setState({ transcript: [{ kind: "user", text: "a" }], messages: [{ role: "user", content: "a" }] });
    useAgentStore.getState()._persistConversation();
    expect(store.conversation).toEqual({
      v: 1,
      transcript: [{ kind: "user", text: "a" }],
      messages: [{ role: "user", content: "a" }],
    });
  });

  it("initAgent still hydrates mode and allowlist when the conversation read throws", async () => {
    // Pre-existing state, so a broken intermediate value (partially applied,
    // or wiped) would be visible instead of masked by the empty default.
    useAgentStore.setState({ transcript: [{ kind: "user", text: "kept" }], messages: [{ role: "user", content: "kept" }] });
    const api = {
      storage: {
        get: vi.fn(async (k: string) => {
          if (k === "conversation") throw new Error("disk read failed");
          if (k === "agentMode") return "auto";
          return null;
        }),
        set: vi.fn(),
        delete: vi.fn(),
      },
      keychain: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
      sessions: { list: () => [] },
      connections: { list: async () => [] },
    } as never;
    await initAgent(api);
    expect(useAgentStore.getState().mode).toBe("auto");
    expect(useAgentStore.getState().allowlist).toEqual([]);
    // A throw in readConversation must be treated exactly like "no persisted
    // data" — the live transcript/messages are left untouched, not reset to
    // some broken intermediate value.
    expect(useAgentStore.getState().transcript).toEqual([{ kind: "user", text: "kept" }]);
    expect(useAgentStore.getState().messages).toEqual([{ role: "user", content: "kept" }]);
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
    const entry: AllowlistEntry = { scope: "web-01", tool: "run_command", grain: "exact", key: "apt update" };
    useAgentStore.getState().addAllowlist(entry);
    expect(useAgentStore.getState().hasAllowlist(entry)).toBe(true);
    await vi.waitFor(() => expect(persisted.allowlist).toEqual([entry]));
  });

  it("addAllowlist refuses to persist a key containing a shell metacharacter (defense in depth)", async () => {
    const persisted: Record<string, unknown> = {};
    await initAgent(fakeApi(persisted));
    const entry: AllowlistEntry = { scope: "web-01", tool: "run_command", grain: "exact", key: "df -h !sudo" };
    useAgentStore.getState().addAllowlist(entry);
    expect(useAgentStore.getState().hasAllowlist(entry)).toBe(false);
    expect(useAgentStore.getState().allowlist).toEqual([]);
    expect(persisted.allowlist).toBeUndefined();
  });

  it("resolveApproval calls the stored resolver and removes the record", () => {
    const resolve = vi.fn();
    useAgentStore.setState({
      pendingApprovals: [{ id: "a1", tool: "run_command", args: {}, scope: "h", grants: [], resolve }],
    });
    useAgentStore.getState().resolveApproval("a1", { approve: true, scope: "h", via: "prompted" });
    expect(resolve).toHaveBeenCalledWith({ approve: true, scope: "h", via: "prompted" });
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
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
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
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
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
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
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
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
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
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
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
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
    } as never);

    const sendPromise = useAgentStore.getState().sendMessage("hello");
    await vi.waitFor(() => expect(useAgentStore.getState().runStatus).toBe("streaming"));
    useAgentStore.getState().stop();
    await sendPromise;

    expect(useAgentStore.getState().runStatus).toBe("idle");
    expect(useAgentStore.getState().errorText).toBeNull();
  });

  it("a finishing run does not null a newer run's controller (stop() during run 2 still aborts run 2)", async () => {
    // The single-flight guard only checks runStatus at the very top of
    // sendMessage, before any await — so firing two calls back-to-back
    // (neither awaited) lets both pass the guard in the same tick, before
    // either has set runStatus to "streaming". That's the only way two
    // *overlapping* runs reach this module's shared `abortController` at
    // once through the public API. Run 1 is wired to finish fast; run 2 is
    // wired to still be streaming when run 1's `finally` fires — the exact
    // window where the old unconditional `abortController = null` would null
    // run 2's controller out from under it.
    (runAgent as unknown as ReturnType<typeof vi.fn>).mockClear();
    let doStreamCalls = 0;
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => {
        doStreamCalls += 1;
        if (doStreamCalls === 1) {
          // Run 1: finishes immediately.
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: "text-start", id: "0" },
                { type: "text-delta", id: "0", delta: "fast" },
                { type: "text-end", id: "0" },
                FINISH_CHUNK,
              ],
            }),
          };
        }
        // Run 2: still streaming well after run 1 has settled.
        return {
          stream: simulateReadableStream({
            chunkDelayInMs: 30,
            chunks: [
              { type: "text-start", id: "1" },
              { type: "text-delta", id: "1", delta: "slow" },
              { type: "text-end", id: "1" },
              FINISH_CHUNK,
            ],
          }),
        };
      },
    });
    _setDeps({
      api: fakeApi(),
      profiles: {
        list: async () => [{ id: "p1", providerKind: "anthropic", label: "A", model: "claude-x" }],
        getActiveId: async () => "p1",
        getKey: async () => "sk-test",
      } as never,
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
    } as never);

    const firstPromise = useAgentStore.getState().sendMessage("first");
    const secondPromise = useAgentStore.getState().sendMessage("second");

    await firstPromise; // run 1 settles while run 2 is still mid-stream
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(2));

    useAgentStore.getState().stop();

    const calls = (runAgent as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const run2Signal = (calls[1][0] as { abortSignal?: AbortSignal }).abortSignal;
    expect(run2Signal?.aborted).toBe(true); // run 1's finally must not have nulled run 2's controller

    await secondPromise;
  });

  it("a run superseded by a newer run does not durably persist its stale responseMessages", async () => {
    // Same overlapping-runs setup as the controller-nulling test above: two
    // sendMessage calls fired back-to-back (neither awaited) so both bump
    // their own generation before either's model finishes streaming. Run 1
    // is wired to finish fast — by the time its success block reaches
    // _persistConversation, run 2 has already bumped runGeneration past it.
    (runAgent as unknown as ReturnType<typeof vi.fn>).mockClear();
    const store: Record<string, unknown> = {};
    let doStreamCalls = 0;
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => {
        doStreamCalls += 1;
        if (doStreamCalls === 1) {
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: "text-start", id: "0" },
                { type: "text-delta", id: "0", delta: "fast" },
                { type: "text-end", id: "0" },
                FINISH_CHUNK,
              ],
            }),
          };
        }
        return {
          stream: simulateReadableStream({
            chunkDelayInMs: 30,
            chunks: [
              { type: "text-start", id: "1" },
              { type: "text-delta", id: "1", delta: "slow" },
              { type: "text-end", id: "1" },
              FINISH_CHUNK,
            ],
          }),
        };
      },
    });
    _setDeps({
      api: fakeApi(store),
      profiles: {
        list: async () => [{ id: "p1", providerKind: "anthropic", label: "A", model: "claude-x" }],
        getActiveId: async () => "p1",
        getKey: async () => "sk-test",
      } as never,
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
    } as never);

    const firstPromise = useAgentStore.getState().sendMessage("first");
    const secondPromise = useAgentStore.getState().sendMessage("second");

    await firstPromise; // run 1 (now superseded by run 2) settles first
    expect(store.conversation).toBeUndefined();

    await secondPromise; // run 2 is still the current generation and persists normally
    expect(store.conversation).toBeDefined();
  });

  it("a superseded run's onText/onTool/success-set do not mutate messages or transcript either — not just the durable write", async () => {
    // Same overlapping-runs setup as above, but this pins the actual finding:
    // before the fix, only _persistConversation was gated, so run 1's stale
    // text delta, tool call/result, and responseMessages append all landed in
    // the live store even though the durable write was correctly skipped.
    (runAgent as unknown as ReturnType<typeof vi.fn>).mockClear();
    let doStreamCalls = 0;
    mockModel.current = new MockLanguageModelV4({
      doStream: async () => {
        doStreamCalls += 1;
        if (doStreamCalls === 1) {
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: "text-start", id: "0" },
                { type: "text-delta", id: "0", delta: "STALE TEXT" },
                { type: "text-end", id: "0" },
                { type: "tool-call", toolCallId: "c1", toolName: "read_terminal", input: JSON.stringify({ sessionId: "s1" }) },
                FINISH_CHUNK,
              ],
            }),
          };
        }
        return {
          stream: simulateReadableStream({
            chunkDelayInMs: 30,
            chunks: [
              { type: "text-start", id: "1" },
              { type: "text-delta", id: "1", delta: "fresh" },
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
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
    } as never);

    const firstPromise = useAgentStore.getState().sendMessage("first");
    const secondPromise = useAgentStore.getState().sendMessage("second");

    await firstPromise;
    await secondPromise;

    const { transcript, messages } = useAgentStore.getState();
    expect(transcript.some((e) => e.kind === "assistant" && e.text.includes("STALE"))).toBe(false);
    expect(transcript.some((e) => e.kind === "tool" && e.tool === "read_terminal")).toBe(false);
    expect(JSON.stringify(messages)).not.toContain("STALE TEXT");
    // Run 2 is still the live generation: its own text must land normally.
    expect(transcript.some((e) => e.kind === "assistant" && e.text === "fresh")).toBe(true);
  });

  it("an aborted run — still the current generation — still applies its onText delta to the transcript (unlike a superseded run)", async () => {
    // Pins that the gate is superseded-ness (runGeneration !== generation),
    // not isGenerationDead: a Stop only stamps abortedGeneration, it never
    // moves runGeneration, so this run's already-landed delta must survive.
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
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
    } as never);

    const sendPromise = useAgentStore.getState().sendMessage("hello");
    await vi.waitFor(() =>
      expect(useAgentStore.getState().transcript.some((e) => e.kind === "assistant" && e.text === "Hi")).toBe(true),
    );
    useAgentStore.getState().stop();
    await sendPromise;

    expect(useAgentStore.getState().runStatus).toBe("idle");
    expect(useAgentStore.getState().transcript.some((e) => e.kind === "assistant" && e.text === "Hi")).toBe(true);
  });

  it("an aborted run — still the current generation — persists the conversation (unlike a superseded one)", async () => {
    // Pins the distinction the fix relies on: gating on isGenerationDead
    // instead of runGeneration === generation would wrongly skip this write,
    // since abortedGeneration === generation is exactly what isGenerationDead
    // checks for a Stop.
    const store: Record<string, unknown> = {};
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
      api: fakeApi(store),
      profiles: {
        list: async () => [{ id: "p1", providerKind: "anthropic", label: "A", model: "claude-x" }],
        getActiveId: async () => "p1",
        getKey: async () => "sk-test",
      } as never,
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
    } as never);

    const sendPromise = useAgentStore.getState().sendMessage("hello");
    await vi.waitFor(() => expect(useAgentStore.getState().runStatus).toBe("streaming"));
    useAgentStore.getState().stop();
    await sendPromise;

    expect(useAgentStore.getState().runStatus).toBe("idle");
    expect(store.conversation).toBeDefined();
    expect((store.conversation as { messages: Array<{ content: string }> }).messages).toEqual(
      expect.arrayContaining([{ role: "user", content: "hello" }]),
    );
  });

  it("surfaces a provider failure that races a Stop, instead of swallowing it as a clean cancel", async () => {
    // signal.aborted becomes true (via stop()) in the same tick a genuine,
    // non-AbortError-shaped provider failure is thrown — isAbortError must
    // not treat the aborted signal alone as proof of a deliberate Stop.
    (runAgent as unknown as ReturnType<typeof vi.fn>).mockClear();
    mockModel.current = new MockLanguageModelV4({
      doStream: async ({ abortSignal }: { abortSignal?: AbortSignal }) => {
        await new Promise<void>((resolve) => {
          if (abortSignal?.aborted) resolve();
          else abortSignal?.addEventListener("abort", () => resolve());
        });
        throw new TypeError("fetch failed");
      },
    });
    _setDeps({
      api: fakeApi(),
      profiles: {
        list: async () => [{ id: "p1", providerKind: "anthropic", label: "A", model: "claude-x" }],
        getActiveId: async () => "p1",
        getKey: async () => "sk-test",
      } as never,
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
    } as never);

    const sendPromise = useAgentStore.getState().sendMessage("hello");
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(1));
    useAgentStore.getState().stop();
    await sendPromise;

    expect(useAgentStore.getState().runStatus).toBe("error");
    expect(useAgentStore.getState().errorText).not.toBeNull();
    expect(useAgentStore.getState().errorText).not.toMatch(/aborted/i);
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
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
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
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
    } as never);

    const sendPromise = useAgentStore.getState().sendMessage("hello");
    await vi.waitFor(() => expect(useAgentStore.getState().runStatus).toBe("streaming"));

    // A card that arose *during* this in-flight run (e.g. a tool awaiting
    // approval mid-turn) — not a stale leftover from before sendMessage was
    // called, which sendMessage's own supersession reap would now claim
    // first with reason "superseded" rather than exercising shutdownAgent's
    // independent rejection.
    const pendingResolve = vi.fn();
    useAgentStore.setState({
      pendingApprovals: [{ id: "p1", tool: "run_command", args: {}, scope: "h", grants: [], resolve: pendingResolve }],
    });

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
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
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
    // Bind the approval port to the current generation exactly as sendMessage
    // does for a real run, then cancel that generation.
    const gen = _currentRunGeneration();
    useAgentStore.getState().stop(); // marks the current run generation aborted, nothing else in flight

    const ctx = {
      api: api as never,
      approve: (c: { tool: string; args: Record<string, unknown> }) => getAgentDeps()!.controller.approve(c, gen),
      proposePlan: async () => ({ approve: false as const }),
      owned: new Set<string>(),
    };
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
      pendingApprovals: [{ id: "stale-1", tool: "run_command", args: {}, scope: "h", grants: [], resolve }],
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

    const gen = _currentRunGeneration();
    const ctx = {
      api: api as never,
      approve: (c: { tool: string; args: Record<string, unknown> }) => getAgentDeps()!.controller.approve(c, gen),
      proposePlan: async () => ({ approve: false as const }),
      owned: new Set<string>(),
    };
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

  it("newConversation clears the transcript, messages, and the persisted key", async () => {
    const store: Record<string, unknown> = { conversation: { v: 1, transcript: [], messages: [] } };
    const api = fakeApi(store);
    _setDeps({ api, profiles: {} as never, controller: {} as never });
    useAgentStore.setState({ transcript: [{ kind: "user", text: "old" }], messages: [{ role: "user", content: "old" }] });
    await useAgentStore.getState().newConversation();
    expect(useAgentStore.getState().transcript).toEqual([]);
    expect(useAgentStore.getState().messages).toEqual([]);
    expect((api as unknown as { storage: { delete: ReturnType<typeof vi.fn> } }).storage.delete).toHaveBeenCalledWith("conversation");
  });

  it("newConversation resets the mode to the stored global default", async () => {
    _setDeps({ api: fakeApi({ agentMode: "plan" }), profiles: {} as never, controller: {} as never });
    useAgentStore.setState({ mode: "auto" });
    await useAgentStore.getState().newConversation();
    expect(useAgentStore.getState().mode).toBe("plan");
  });

  it("newConversation falls back to ask when no global default is stored", async () => {
    _setDeps({ api: fakeApi({}), profiles: {} as never, controller: {} as never });
    useAgentStore.setState({ mode: "auto" });
    await useAgentStore.getState().newConversation();
    expect(useAgentStore.getState().mode).toBe("ask");
  });

  it("newConversation rejects pending approvals and bumps the generation", async () => {
    _setDeps({ api: fakeApi({}), profiles: {} as never, controller: {} as never });
    const resolve = vi.fn();
    useAgentStore.getState()._addPending({
      id: "p1", tool: "run_command", args: { command: "df" }, scope: "c1", grants: [], resolve,
    });
    const before = _currentRunGeneration();
    await useAgentStore.getState().newConversation();
    expect(resolve).toHaveBeenCalledWith({ approve: false, reason: "superseded" });
    expect(useAgentStore.getState().pendingApprovals).toEqual([]);
    expect(_currentRunGeneration()).toBeGreaterThan(before);
  });

  it("newConversation drops owned sessions so a recalled id is refused", async () => {
    // MUST observe the store's own module-private ownedSessions, not a local
    // Set: a test that builds its own Set passes even if newConversation resets
    // nothing. The store hands the live Set to every tool context as `ctx.owned`
    // (agentStore.ts:245), so capture it from the spied runAgent call.
    // Cleared first so calls[0]/calls[1] below are this test's own two
    // dispatches, not leftover history from earlier tests in this file.
    vi.mocked(runAgent).mockClear();
    _setDeps({ api: fakeApi({}), profiles: profilesStub(), controller: approveAllController() });
    await useAgentStore.getState().sendMessage("open a session");
    const owned = vi.mocked(runAgent).mock.calls[0][0].ctx.owned;
    owned.add("sess-old"); // stand in for a completed open_session

    await useAgentStore.getState().newConversation();

    await useAgentStore.getState().sendMessage("reuse that session");
    const ownedAfter = vi.mocked(runAgent).mock.calls[1][0].ctx.owned;
    expect(ownedAfter.has("sess-old")).toBe(false);

    // And the refusal is real, not merely an empty set.
    const run = buildTools({
      api: fakeApi({}) as never,
      approve: async () => ({ approve: true, scope: "c1", via: "granted" }),
      proposePlan: async () => ({ approve: false as const }),
      owned: ownedAfter,
    } as AgentContext).find((t) => t.name === "run_command")!;
    await expect(run.execute({ sessionId: "sess-old", command: "ls" })).resolves.toMatchObject({
      error: expect.stringContaining("not owned by agent"),
    });
  });

  it("sendMessage folds the attached context into the message and clears the chip", async () => {
    // Uses the existing mockModel harness in this file.
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
    _setDeps({ api: fakeApi({}), profiles: profilesStub(), controller: approveAllController() });
    useAgentStore.getState().attachContext({
      sessionId: "s1", connectionName: "Prod DB", source: "selection", text: "boom", lineCount: 1, truncated: false,
    });
    await useAgentStore.getState().sendMessage("why did this fail?");
    const first = useAgentStore.getState().messages[0] as { content: string };
    expect(first.content).toContain("why did this fail?");
    expect(first.content).toContain("Attached from Prod DB");
    expect(useAgentStore.getState().pendingContext).toBeNull();
    expect(useAgentStore.getState().transcript[0]).toEqual({
      kind: "user",
      text: "why did this fail?",
      attachment: { source: "selection", lineCount: 1, connectionName: "Prod DB", truncated: false },
    });
  });

  it("a second message does not re-attach the consumed context", async () => {
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
    _setDeps({ api: fakeApi({}), profiles: profilesStub(), controller: approveAllController() });
    useAgentStore.getState().attachContext({
      sessionId: "s1", connectionName: "Prod DB", source: "snapshot", text: "log", lineCount: 1, truncated: false,
    });
    await useAgentStore.getState().sendMessage("first");
    await useAgentStore.getState().sendMessage("second");
    const second = useAgentStore.getState().messages.find((m) => m.role === "user" && String(m.content).startsWith("second"));
    expect(String(second?.content)).not.toContain("Attached from");
  });

  it("clearContext drops the chip", () => {
    useAgentStore.getState().attachContext({
      sessionId: "s1", connectionName: "Prod DB", source: "snapshot", text: "log", lineCount: 1, truncated: false,
    });
    useAgentStore.getState().clearContext();
    expect(useAgentStore.getState().pendingContext).toBeNull();
  });

  it("newConversation clears a pending context chip", async () => {
    _setDeps({ api: fakeApi({}), profiles: {} as never, controller: {} as never });
    useAgentStore.getState().attachContext({
      sessionId: "s1", connectionName: "Prod DB", source: "snapshot", text: "log", lineCount: 1, truncated: false,
    });
    await useAgentStore.getState().newConversation();
    expect(useAgentStore.getState().pendingContext).toBeNull();
  });

  it("shutdownAgent clears a pending context chip so it doesn't survive a disable/enable", async () => {
    _setDeps({ api: fakeApi({}), profiles: {} as never, controller: {} as never });
    useAgentStore.getState().attachContext({
      sessionId: "s1", connectionName: "Prod DB", source: "snapshot", text: "log", lineCount: 1, truncated: false,
    });
    shutdownAgent();
    expect(useAgentStore.getState().pendingContext).toBeNull();
  });

  it("newConversation clears synchronously — transcript, messages, and mode all move before the mode read settles", async () => {
    let resolveGet!: (v: Mode | null) => void;
    const pendingGet = new Promise<Mode | null>((r) => { resolveGet = r; });
    const api = {
      storage: {
        get: vi.fn(() => pendingGet),
        set: vi.fn(),
        delete: vi.fn(),
      },
      keychain: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
      sessions: { list: () => [] },
      connections: { list: async () => [] },
    } as never;
    _setDeps({ api, profiles: {} as never, controller: {} as never });
    useAgentStore.setState({
      mode: "auto",
      transcript: [{ kind: "user", text: "old" }],
      messages: [{ role: "user", content: "old" }],
    });

    const p = useAgentStore.getState().newConversation();
    // Everything but the mode read has already moved by the time
    // newConversation returns — a concurrent sendMessage cannot see, or
    // produce, a half-migrated state. The mode sits at the safe interim
    // value (never "auto", the mode that was just abandoned) until the read
    // resolves.
    expect(useAgentStore.getState().mode).toBe("plan");
    expect(useAgentStore.getState().transcript).toEqual([]);
    expect(useAgentStore.getState().messages).toEqual([]);

    resolveGet("ask");
    await p;

    expect(useAgentStore.getState().mode).toBe("ask");
  });

  it("newConversation completes the synchronous clear even when the mode read rejects", async () => {
    const storageDelete = vi.fn();
    const api = {
      storage: {
        get: vi.fn(() => Promise.reject(new Error("storage unavailable"))),
        set: vi.fn(),
        delete: storageDelete,
      },
      keychain: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
      sessions: { list: () => [] },
      connections: { list: async () => [] },
    } as never;
    _setDeps({ api, profiles: {} as never, controller: {} as never });
    useAgentStore.setState({
      mode: "auto",
      transcript: [{ kind: "user", text: "old" }],
      messages: [{ role: "user", content: "old" }],
      pendingContext: { sessionId: "s1", connectionName: "Prod", source: "snapshot", text: "x", lineCount: 1, truncated: false },
      runStatus: "streaming",
      errorText: "boom",
    });

    // Called the way production code calls it — `void newConversation()` —
    // so a throw escaping the action would surface as an unhandled
    // rejection, not a failed await here.
    await useAgentStore.getState().newConversation();

    expect(useAgentStore.getState().transcript).toEqual([]);
    expect(useAgentStore.getState().messages).toEqual([]);
    expect(useAgentStore.getState().pendingContext).toBeNull();
    expect(useAgentStore.getState().runStatus).toBe("idle");
    expect(useAgentStore.getState().errorText).toBeNull();
    expect(storageDelete).toHaveBeenCalledWith("conversation");
    // The rejection left the mode at the safe interim value rather than
    // propagating out or leaving the old "auto" in place.
    expect(useAgentStore.getState().mode).toBe("plan");
  });

  it("a newConversation superseded by a later action before its mode read resolves does not write the mode", async () => {
    let resolveFirst!: (v: Mode | null) => void;
    const pendingFirst = new Promise<Mode | null>((r) => { resolveFirst = r; });
    let firstCall = true;
    const api = {
      storage: {
        get: vi.fn(() => {
          if (firstCall) { firstCall = false; return pendingFirst; }
          return Promise.resolve("auto" as Mode);
        }),
        set: vi.fn(),
        delete: vi.fn(),
      },
      keychain: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
      sessions: { list: () => [] },
      connections: { list: async () => [] },
    } as never;
    _setDeps({ api, profiles: {} as never, controller: {} as never });

    const first = useAgentStore.getState().newConversation();
    // The second call bumps runGeneration again before the first call's
    // mode read has a chance to resolve, so it supersedes the first.
    const second = useAgentStore.getState().newConversation();
    await second;
    expect(useAgentStore.getState().mode).toBe("auto");

    resolveFirst("ask");
    await first;
    // The superseded first call must not clobber the second (newer) call's
    // resolved mode with its own stale read.
    expect(useAgentStore.getState().mode).toBe("auto");
  });

  it("newConversation's interim mode is never more permissive than a stricter stored default", async () => {
    // "plan" is the strictest mode (executes nothing), so it can never be
    // *more* permissive than whatever the stored default turns out to be —
    // unlike "ask" (prompts on risky actions, but still auto-runs the rest)
    // or "auto" (auto-approves everything), either of which could be more
    // permissive than a "plan" default while the read is still in flight.
    let resolveGet!: (v: Mode | null) => void;
    const pendingGet = new Promise<Mode | null>((r) => { resolveGet = r; });
    const api = {
      storage: { get: vi.fn(() => pendingGet), set: vi.fn(), delete: vi.fn() },
      keychain: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
      sessions: { list: () => [] },
      connections: { list: async () => [] },
    } as never;
    _setDeps({ api, profiles: {} as never, controller: {} as never });
    useAgentStore.setState({ mode: "auto" });

    const p = useAgentStore.getState().newConversation();
    expect(useAgentStore.getState().mode).toBe("plan");

    resolveGet("plan");
    await p;
    expect(useAgentStore.getState().mode).toBe("plan");
  });
});

// ── Approval generation binding ──────────────────────────────────────────────
//
// The abort latch is only sound if every approval is bound to the *run that
// dispatched it*. These tests drive the REAL store, the REAL controller (via
// initAgent), the REAL deriveScope, and the REAL tool registry across run and
// activation boundaries — nothing here hand-rolls `isAborted`, because a
// hand-rolled latch is exactly what let the hole survive the previous wave.
describe("approval generation binding", () => {
  const PROFILE = { id: "p1", providerKind: "anthropic", label: "A", model: "claude-x" };

  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  /**
   * Resolve `p`, or yield a sentinel if it is still parked. Turns "the
   * approval promise never came back" (the pre-fix failure mode: a card is
   * registered that nothing will ever resolve) into a readable assertion
   * diff instead of a whole-file test timeout.
   */
  function settledOr<T>(p: Promise<T>): Promise<T | string> {
    return Promise.race([p, new Promise<string>((r) => setTimeout(() => r("STILL PENDING"), 50))]);
  }

  /** A plugin API whose `connections.list` (the one real await inside
   *  deriveScope) is held open until the test lets it go. */
  function harness(store: Record<string, unknown>) {
    const openSpy = vi.fn(async () => "sess-1");
    const conns = deferred<Array<{ id: string; name: string; host: string }>>();
    let requested = 0;
    const api = {
      storage: {
        get: vi.fn(async (k: string) => (k in store ? store[k] : null)),
        set: vi.fn(async (k: string, v: unknown) => { store[k] = v; }),
        delete: vi.fn(),
      },
      keychain: { get: vi.fn(async () => "sk-test"), set: vi.fn(), delete: vi.fn() },
      sessions: { list: () => [], open: openSpy },
      connections: { list: vi.fn(() => { requested += 1; return conns.promise; }) },
    };
    return { api, openSpy, conns, requested: () => requested };
  }

  function textModel(text: string) {
    return new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "0" },
            { type: "text-delta", id: "0", delta: text },
            { type: "text-end", id: "0" },
            FINISH_CHUNK,
          ],
        }),
      }),
    });
  }

  const spy = () => runAgent as unknown as ReturnType<typeof vi.fn>;
  const lastCtx = () => {
    const calls = spy().mock.calls;
    return (calls[calls.length - 1][0] as { ctx: AgentContext }).ctx;
  };

  /** Run one real turn and hand back its ctx — whose `approve` is bound to
   *  that run's generation exactly as production binds it. */
  async function runTurn(text: string): Promise<AgentContext> {
    mockModel.current = textModel("ok");
    await useAgentStore.getState().sendMessage(text);
    return lastCtx();
  }

  const openSessionOf = (ctx: AgentContext) => buildTools(ctx).find((t) => t.name === "open_session")!;
  const CONN = { id: "c1", name: "srv", host: "web-01" };

  beforeEach(() => {
    spy().mockClear();
    useAgentStore.setState({
      mode: "ask", allowlist: [], pendingApprovals: [], runStatus: "idle",
      errorText: null, transcript: [], messages: [],
    });
  });

  // Test 1 — Path 1. Teardown stamps the latch for run N; re-enabling the
  // plugin must NOT bring run N's parked approval back to life. (Pre-fix,
  // initAgent cleared `abortedGeneration`, so the parked call resumed with
  // the latch off and registered a card in the freshly re-enabled drawer.)
  it("Path 1: an approval parked in deriveScope stays refused across shutdownAgent + a re-enabling initAgent", async () => {
    const h = harness({ providerProfiles: [PROFILE], activeProfileId: "p1" });
    await initAgent(h.api as never);
    const ctx = await runTurn("hello");

    const exec = openSessionOf(ctx).execute({ connectionId: "c1" });
    await vi.waitFor(() => expect(h.requested()).toBe(1)); // parked inside deriveScope

    shutdownAgent();
    await initAgent(h.api as never); // user re-enables the plugin

    h.conns.resolve([CONN]);

    expect(await settledOr(exec)).toEqual({ error: "rejected by user", reason: "aborted" });
    expect(useAgentStore.getState().pendingApprovals).toHaveLength(0);
    expect(h.openSpy).not.toHaveBeenCalled();
  });

  // Test 2 — Path 1 through the allowlist shortcut, which returns
  // {approve:true} with no card at all, so a hole here is completely silent.
  it("Path 1 via the allowlist shortcut: a parked approval is still refused after shutdownAgent + initAgent, and never returns approve:true", async () => {
    const GRANT: AllowlistEntry = { scope: "c1", tool: "open_session", grain: "tool", key: "open_session" };
    const h = harness({
      providerProfiles: [PROFILE],
      activeProfileId: "p1",
      allowlist: [GRANT],
    });
    await initAgent(h.api as never);
    expect(useAgentStore.getState().hasAllowlist(GRANT)).toBe(true);
    const ctx = await runTurn("hello");

    const exec = openSessionOf(ctx).execute({ connectionId: "c1" });
    await vi.waitFor(() => expect(h.requested()).toBe(1));

    shutdownAgent();
    await initAgent(h.api as never);
    // The re-enabled activation reloads the same allowlist, so the shortcut
    // WOULD fire if the generation check didn't refuse first.
    expect(useAgentStore.getState().hasAllowlist(GRANT)).toBe(true);

    h.conns.resolve([CONN]);

    expect(await settledOr(exec)).toEqual({ error: "rejected by user", reason: "aborted" });
    expect(h.openSpy).not.toHaveBeenCalled();
    expect(useAgentStore.getState().pendingApprovals).toHaveLength(0);
  });

  // Test 3 — Path 2. `consumeStream`'s error part flips runStatus out of
  // "streaming" while this run's tools can still be in flight, which re-opens
  // sendMessage's single-flight guard. A new run then bumps the generation —
  // with nothing ever aborted — and the old run's parked call must still die.
  it("Path 2: an approval parked during run N is refused once run N+1 has started, even though nothing was ever aborted", async () => {
    const h = harness({ providerProfiles: [PROFILE], activeProfileId: "p1" });
    await initAgent(h.api as never);

    mockModel.current = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: [{ type: "error", error: new Error("provider exploded") }] }),
      }),
    });
    await useAgentStore.getState().sendMessage("first");
    expect(useAgentStore.getState().runStatus).toBe("error"); // guard is open again
    const ctx = lastCtx();

    const exec = openSessionOf(ctx).execute({ connectionId: "c1" });
    await vi.waitFor(() => expect(h.requested()).toBe(1));

    await runTurn("second"); // the user retypes: generation N -> N+1

    h.conns.resolve([CONN]);

    expect(await settledOr(exec)).toEqual({ error: "rejected by user", reason: "aborted" });
    expect(useAgentStore.getState().pendingApprovals).toHaveLength(0);
    expect(h.openSpy).not.toHaveBeenCalled();
  });

  // Test 3b — a card that already made it into `pendingApprovals` (not just
  // parked in deriveScope) from run N must be rejected+cleared the moment run
  // N+1 supersedes it. Unlike Path 2 above, `deps.deriveScope` has already
  // resolved and `addPending` has already run by the time run N+1 starts, so
  // isGenerationDead's re-check inside `approve()` can no longer catch this —
  // only an explicit reap of `pendingApprovals` at run dispatch does.
  it("a pending approval CARD from run N is rejected and cleared once run N+1 starts, and its tool never executes", async () => {
    const h = harness({ providerProfiles: [PROFILE], activeProfileId: "p1" });
    await initAgent(h.api as never);
    const ctx = await runTurn("first"); // run N

    const exec = openSessionOf(ctx).execute({ connectionId: "c1" });
    h.conns.resolve([CONN]); // let deriveScope resolve so the card is registered
    await vi.waitFor(() => expect(useAgentStore.getState().pendingApprovals).toHaveLength(1));

    await runTurn("second"); // run N+1 supersedes it

    expect(await settledOr(exec)).toEqual({ error: "rejected by user", reason: "superseded" });
    expect(useAgentStore.getState().pendingApprovals).toHaveLength(0);
    expect(h.openSpy).not.toHaveBeenCalled();
  });

  // Test 4 — the top-of-call gate must be generation-bound, not merely
  // latch-bound. In `auto` mode there is no await before it, so this can only
  // pass if the generation is bound at run dispatch: a call that captured
  // "whatever generation is current" on entry would read the LIVE one and be
  // auto-approved with no card and no trace.
  it("auto mode: a tool call carrying a superseded run's generation is refused, consulting the connection list exactly once, before the gate", async () => {
    const h = harness({ providerProfiles: [PROFILE], activeProfileId: "p1" });
    await initAgent(h.api as never);
    useAgentStore.getState().setMode("auto");

    const ctx = await runTurn("first"); // run N
    await runTurn("second"); // run N+1 supersedes it

    const exec = openSessionOf(ctx).execute({ connectionId: "c1" });
    h.conns.resolve([CONN]); // let the connection-id guard's own lookup complete
    // A count of 1 means the top-of-approve() abort check caught it before
    // deriveScope's own lookup; 2 would mean it slipped past that check.
    expect(await settledOr(exec)).toEqual({ error: "rejected by user", reason: "aborted" });
    expect(h.openSpy).not.toHaveBeenCalled();
    expect(h.requested()).toBe(1);
  });

  // Test 5 — the Important. `sendMessage` captures `deps` and then awaits two
  // profile lookups; a teardown landing there must not be followed by a
  // generation bump and a whole approvable run driven through the dead API.
  it("sendMessage abandons the send when the plugin is torn down during the profile lookups", async () => {
    const activeId = deferred<string | null>();
    _setDeps({
      api: fakeApi(),
      profiles: {
        list: async () => [PROFILE],
        getActiveId: () => activeId.promise,
        getKey: async () => "sk-test",
      } as never,
      controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) },
    } as never);
    mockModel.current = textModel("should not run");

    const p = useAgentStore.getState().sendMessage("hello");
    shutdownAgent(); // lands inside the getActiveId await
    activeId.resolve("p1");
    await p;

    expect(spy()).not.toHaveBeenCalled();
    expect(useAgentStore.getState().runStatus).toBe("idle");
    expect(useAgentStore.getState().transcript).toEqual([]);
    expect(useAgentStore.getState().messages).toEqual([]);
  });

  it("sendMessage abandons the send when deps are REPLACED (disable + re-enable) during the profile lookups", async () => {
    const activeId = deferred<string | null>();
    const profiles = {
      list: async () => [PROFILE],
      getActiveId: () => activeId.promise,
      getKey: async () => "sk-test",
    } as never;
    _setDeps({ api: fakeApi(), profiles, controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) } } as never);
    mockModel.current = textModel("should not run");

    const p = useAgentStore.getState().sendMessage("hello");
    // A fresh activation swaps in a different deps object under the same key.
    _setDeps({ api: fakeApi(), profiles, controller: { approve: async () => ({ approve: true, scope: "c1", via: "granted" }) } } as never);
    activeId.resolve("p1");
    await p;

    expect(spy()).not.toHaveBeenCalled();
    expect(useAgentStore.getState().runStatus).toBe("idle");
    expect(useAgentStore.getState().transcript).toEqual([]);
  });

  // Test 6 — the happy path must be untouched: a live generation still raises
  // a card, still executes on approval, and still takes the allowlist
  // shortcut on the next identical call.
  it("a normal, non-aborted run still approves: card path executes, then the allowlist shortcut does", async () => {
    const h = harness({ providerProfiles: [PROFILE], activeProfileId: "p1" });
    await initAgent(h.api as never);
    const ctx = await runTurn("hello");
    h.conns.resolve([CONN]);

    const openSession = openSessionOf(ctx);
    const exec = openSession.execute({ connectionId: "c1" });
    await vi.waitFor(() => expect(useAgentStore.getState().pendingApprovals).toHaveLength(1));
    const card = useAgentStore.getState().pendingApprovals[0];
    expect(card).toMatchObject({
      tool: "open_session",
      scope: "c1",
      grants: [{ scope: "c1", tool: "open_session", grain: "tool", key: "open_session" }],
    });

    useAgentStore.getState().resolveApproval(card.id, { approve: true, scope: "c1", via: "prompted" });
    expect(await exec).toEqual({ sessionId: "sess-1" });
    expect(h.openSpy).toHaveBeenCalledWith("c1");

    useAgentStore.getState().addAllowlist({ scope: "c1", tool: "open_session", grain: "tool", key: "open_session" });
    expect(await settledOr(openSession.execute({ connectionId: "c1" }))).toEqual({ sessionId: "sess-1" });
    expect(useAgentStore.getState().pendingApprovals).toHaveLength(0);
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

  it("is true when the signal is aborted and the thrown value isn't Error-shaped (no name to check)", () => {
    const ac = new AbortController();
    ac.abort();
    expect(isAbortError("some unrelated string throw", ac.signal)).toBe(true);
  });

  // 10c: an aborted signal alone is not proof of a deliberate Stop — a real
  // provider Error can land in the same tick a user presses Stop, and it must
  // still be surfaced as a failure, not swallowed as a clean cancel.
  it("is false when the signal is aborted but the error is a genuine (non-AbortError-named) Error — a real failure racing a Stop", () => {
    const ac = new AbortController();
    ac.abort();
    expect(isAbortError(new Error("some unrelated network error"), ac.signal)).toBe(false);
  });

  it("is false for a genuine error with a non-aborted (or absent) signal", () => {
    const ac = new AbortController();
    expect(isAbortError(new Error("provider exploded"), ac.signal)).toBe(false);
    expect(isAbortError(new Error("provider exploded"))).toBe(false);
  });
});

describe("allowlist migration + management", () => {
  it("drops legacy {host, key} entries on hydrate", async () => {
    // Legacy 3a shape (first-token prefix) alongside a well-formed entry —
    // only the well-formed one may survive hydrate.
    const legacy = { host: "h", key: "df" };
    const wellFormed: AllowlistEntry = { scope: "h", tool: "run_command", grain: "exact", key: "df -h" };
    const api = fakeApi({ allowlist: [legacy, wellFormed] });
    await initAgent(api);
    expect(useAgentStore.getState().allowlist).toEqual([wellFormed]);
  });

  it("hydrates a non-array persisted allowlist (corrupt/hand-edited storage) to [] and still resets runStatus to idle", async () => {
    // A stale "streaming" status left un-reset here would trip sendMessage's
    // single-flight guard and permanently brick the composer — see the
    // comment above the setState call in initAgent this guards.
    useAgentStore.setState({ runStatus: "streaming" });
    await initAgent(fakeApi({ allowlist: "df" }));
    expect(useAgentStore.getState().allowlist).toEqual([]);
    expect(useAgentStore.getState().runStatus).toBe("idle");
  });

  it("revokeAllAllowlist clears every scope and persists", async () => {
    const persisted: Record<string, unknown> = {};
    await initAgent(fakeApi(persisted));
    useAgentStore.setState({
      allowlist: [
        { scope: "a", tool: "run_command", grain: "exact", key: "df -h" },
        { scope: "b", tool: "open_session", grain: "tool", key: "open_session" },
      ],
    });
    useAgentStore.getState().revokeAllAllowlist();
    expect(useAgentStore.getState().allowlist).toEqual([]);
    await vi.waitFor(() => expect(persisted.allowlist).toEqual([]));
  });

  it("addAllowlist refuses a malformed entry", () => {
    useAgentStore.setState({ allowlist: [] });
    // grain disagrees with the tool kind — a shape allowlistCandidates never emits
    useAgentStore.getState().addAllowlist({ scope: "h", tool: "run_command", grain: "tool", key: "run_command" });
    expect(useAgentStore.getState().allowlist).toEqual([]);
  });
});
