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
});
