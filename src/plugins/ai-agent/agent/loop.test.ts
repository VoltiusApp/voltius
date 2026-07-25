import { describe, test, expect, vi } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { runAgent } from "./loop";
import type { AgentContext } from "../tools/registry";

// v4 usage/finishReason are structured objects (confirmed against
// node_modules/@ai-sdk/provider/dist/index.d.ts LanguageModelV4Usage /
// LanguageModelV4FinishReason), not the flat { inputTokens, outputTokens,
// totalTokens } / plain-string shape the v2 spec used.
const FINISH_CHUNK = {
  type: "finish" as const,
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  },
};

function textOnlyModel(text: string) {
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

function ctx(): AgentContext {
  return {
    approve: vi.fn(async () => ({ approve: true as const, scope: "c1", via: "granted" as const })),
    api: {
      connections: { list: vi.fn(async () => []) },
      sessions: { open: vi.fn(async () => "s1"), close: vi.fn() },
      terminal: { readSnapshot: vi.fn(() => "") },
    } as any,
    owned: new Set<string>(),
  };
}

describe("runAgent", () => {
  test("streams assistant text for a no-tool response", async () => {
    const result = runAgent({ model: textOnlyModel("hello there"), ctx: ctx(), messages: [{ role: "user", content: "hi" }] });
    let acc = "";
    for await (const delta of result.textStream) acc += delta;
    expect(acc).toBe("hello there");
  });

  test("wires the tool set + system prompt into the model call", async () => {
    let captured: any;
    const model = new MockLanguageModelV4({
      doStream: async (options: any) => {
        captured = options;
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start", id: "0" },
              { type: "text-delta", id: "0", delta: "ok" },
              { type: "text-end", id: "0" },
              FINISH_CHUNK,
            ],
          }),
        };
      },
    });
    const result = runAgent({ model, ctx: ctx(), messages: [{ role: "user", content: "hi" }] });
    for await (const _d of result.textStream) { /* drain */ }
    const toolNames = (captured.tools ?? []).map((t: any) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining(["list_connections", "open_session", "run_command", "read_terminal", "close_session"]),
    );
    expect(JSON.stringify(captured.prompt)).toMatch(/Terminal Doctor/);
  });
});
