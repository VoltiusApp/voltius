import { describe, it, expect, vi } from "vitest";
import { consumeStream } from "./conversation";

// Field names verified against node_modules/ai/dist/index.d.ts TextStreamPart
// union (TextStreamTextDeltaPart.text, TextStreamToolCallPart/TypedToolCall
// {toolName, input}, TextStreamToolResultPart/TypedToolResult {toolName,
// output}, TextStreamErrorPart.error) — this is result.fullStream's part
// shape, distinct from the raw doStream mock chunks (which use `delta`).
async function* parts() {
  yield { type: "text-delta", id: "0", text: "Hel" };
  yield { type: "text-delta", id: "0", text: "lo" };
  yield { type: "tool-call", toolCallId: "c1", toolName: "read_terminal", input: { sessionId: "s" } };
  yield { type: "tool-result", toolCallId: "c1", toolName: "read_terminal", output: "ok" };
  yield { type: "finish", finishReason: "stop", rawFinishReason: "stop", totalUsage: {} };
}

describe("consumeStream", () => {
  it("routes text deltas, tool events, and finish to hooks", async () => {
    const hooks = { onText: vi.fn(), onTool: vi.fn(), onError: vi.fn() };
    await consumeStream(parts() as never, hooks);
    expect(hooks.onText.mock.calls.map((c) => c[0]).join("")).toBe("Hello");
    expect(hooks.onTool).toHaveBeenCalledWith("read_terminal", "call", expect.any(String));
    expect(hooks.onTool).toHaveBeenCalledWith("read_terminal", "result", expect.any(String));
    expect(hooks.onError).not.toHaveBeenCalled();
  });

  it("routes error parts to onError", async () => {
    async function* errStream() { yield { type: "error", error: new Error("boom") }; }
    const hooks = { onText: vi.fn(), onTool: vi.fn(), onError: vi.fn() };
    await consumeStream(errStream() as never, hooks);
    expect(hooks.onError).toHaveBeenCalledWith("boom");
  });

  it("serializes object/array tool-result output as JSON, not [object Object]", async () => {
    async function* objectResultStream() {
      yield {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "list_connections",
        output: [{ id: "1", name: "web-01", host: "10.0.0.1" }],
      };
      yield {
        type: "tool-result",
        toolCallId: "c2",
        toolName: "run_command",
        output: { output: "ok\n", exitCode: 0, timedOut: false, truncated: false },
      };
    }
    const hooks = { onText: vi.fn(), onTool: vi.fn(), onError: vi.fn() };
    await consumeStream(objectResultStream() as never, hooks);
    expect(hooks.onTool).toHaveBeenCalledWith(
      "list_connections",
      "result",
      JSON.stringify([{ id: "1", name: "web-01", host: "10.0.0.1" }]),
    );
    expect(hooks.onTool).toHaveBeenCalledWith(
      "run_command",
      "result",
      JSON.stringify({ output: "ok\n", exitCode: 0, timedOut: false, truncated: false }),
    );
    for (const call of hooks.onTool.mock.calls) {
      expect(call[2]).not.toBe("[object Object]");
    }
  });
});
