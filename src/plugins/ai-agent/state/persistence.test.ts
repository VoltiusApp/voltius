import { describe, it, expect } from "vitest";
import type { ModelMessage } from "ai";
import type { TranscriptEntry } from "./agentStore";
import {
  serializeConversation, deserializeConversation,
  MAX_TRANSCRIPT_ENTRIES, MAX_TOOL_RESULT_BYTES, MAX_MESSAGES_BYTES, TRUNCATION_MARKER,
} from "./persistence";

const userMsg = (t: string): ModelMessage => ({ role: "user", content: t });
const assistantText = (t: string): ModelMessage => ({ role: "assistant", content: [{ type: "text", text: t }] });
const toolCall = (id: string): ModelMessage =>
  ({ role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName: "run_command", input: {} }] });
const toolResult = (id: string, output: unknown): ModelMessage =>
  ({ role: "tool", content: [{ type: "tool-result", toolCallId: id, toolName: "run_command", output: output as never }] });

describe("serializeConversation", () => {
  it("stamps the version", () => {
    expect(serializeConversation([], []).v).toBe(1);
  });

  it("keeps only the last MAX_TRANSCRIPT_ENTRIES transcript entries", () => {
    const transcript: TranscriptEntry[] = Array.from({ length: MAX_TRANSCRIPT_ENTRIES + 50 }, (_, i) => ({
      kind: "user" as const, text: `m${i}`,
    }));
    const out = serializeConversation(transcript, []);
    expect(out.transcript).toHaveLength(MAX_TRANSCRIPT_ENTRIES);
    expect((out.transcript[out.transcript.length - 1] as { text: string }).text).toBe(`m${MAX_TRANSCRIPT_ENTRIES + 49}`);
  });

  it("truncates an oversized transcript tool detail", () => {
    const transcript: TranscriptEntry[] = [{ kind: "tool", tool: "run_command", state: "result", detail: "x".repeat(MAX_TOOL_RESULT_BYTES + 500) }];
    const detail = (serializeConversation(transcript, []).transcript[0] as { detail: string }).detail;
    expect(detail.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_BYTES + TRUNCATION_MARKER.length);
    expect(detail.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("truncates an oversized text tool output in messages", () => {
    const messages = [userMsg("go"), toolCall("c1"), toolResult("c1", { type: "text", value: "y".repeat(MAX_TOOL_RESULT_BYTES + 500) })];
    const out = serializeConversation([], messages);
    const part = (out.messages[2] as { content: Array<{ output: { type: string; value: string } }> }).content[0];
    expect(part.output.type).toBe("text");
    expect(part.output.value.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("converts an oversized json tool output to truncated text", () => {
    const big = { output: "z".repeat(MAX_TOOL_RESULT_BYTES + 500), exitCode: 0 };
    const messages = [userMsg("go"), toolCall("c1"), toolResult("c1", { type: "json", value: big })];
    const out = serializeConversation([], messages);
    const part = (out.messages[2] as { content: Array<{ output: { type: string; value: string } }> }).content[0];
    expect(part.output.type).toBe("text");
    expect(part.output.value.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("drops whole leading turns until the byte budget fits", () => {
    const filler = "q".repeat(120_000);
    const messages = [
      userMsg("turn one"), assistantText(filler),
      userMsg("turn two"), assistantText(filler),
      userMsg("turn three"), assistantText(filler),
    ];
    const out = serializeConversation([], messages);
    expect(JSON.stringify(out.messages).length).toBeLessThanOrEqual(MAX_MESSAGES_BYTES);
    expect(out.messages[0]).toEqual(userMsg("turn two"));
  });

  it("never splits a turn: a single oversized turn is kept whole", () => {
    const messages = [userMsg("only turn"), assistantText("w".repeat(MAX_MESSAGES_BYTES + 1000))];
    expect(serializeConversation([], messages).messages).toHaveLength(2);
  });
});

describe("deserializeConversation", () => {
  it("rejects non-objects, wrong versions, and non-array fields", () => {
    expect(deserializeConversation(null)).toBeNull();
    expect(deserializeConversation("nope")).toBeNull();
    expect(deserializeConversation({})).toBeNull();
    expect(deserializeConversation({ v: 2, transcript: [], messages: [] })).toBeNull();
    expect(deserializeConversation({ v: 1, transcript: "x", messages: [] })).toBeNull();
    expect(deserializeConversation({ v: 1, transcript: [], messages: {} })).toBeNull();
  });

  it("round-trips a multi-turn conversation with a resolved tool call", () => {
    const messages = [userMsg("hi"), toolCall("c1"), toolResult("c1", { type: "json", value: { exitCode: 0 } }), assistantText("done")];
    const stored = serializeConversation([{ kind: "user", text: "hi" }], messages);
    const out = deserializeConversation(JSON.parse(JSON.stringify(stored)));
    expect(out?.messages).toHaveLength(4);
    expect(out?.transcript).toHaveLength(1);
  });

  it("drops a trailing tool call that never got a result", () => {
    const messages = [userMsg("hi"), assistantText("ok"), userMsg("run df"), toolCall("c9")];
    const out = deserializeConversation({ v: 1, transcript: [], messages });
    // The user message survives — an aborted turn's prompt must not be lost —
    // but the dangling tool call, which providers reject, is gone.
    expect(out?.messages).toEqual([userMsg("hi"), assistantText("ok"), userMsg("run df")]);
  });

  it("keeps everything when the last tool call was resolved", () => {
    const messages = [userMsg("hi"), toolCall("c1"), toolResult("c1", { type: "text", value: "ok" })];
    expect(deserializeConversation({ v: 1, transcript: [], messages })?.messages).toHaveLength(3);
  });

  it("filters transcript entries of an unknown kind", () => {
    const out = deserializeConversation({
      v: 1,
      transcript: [{ kind: "user", text: "keep" }, { kind: "bogus" }, { kind: "assistant" }],
      messages: [],
    });
    expect(out?.transcript).toEqual([{ kind: "user", text: "keep" }]);
  });
});
