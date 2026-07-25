import { describe, it, expect } from "vitest";
import type { ModelMessage } from "ai";
import type { TranscriptEntry } from "./agentStore";
import {
  serializeConversation, deserializeConversation,
  MAX_TRANSCRIPT_ENTRIES, MAX_TOOL_RESULT_BYTES, MAX_MESSAGES_BYTES, TRUNCATION_MARKER,
  MAX_TRANSCRIPT_TEXT_CHARS, MAX_TRANSCRIPT_BYTES,
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

  it("truncates an oversized error-text tool output in messages", () => {
    const messages = [userMsg("go"), toolCall("c1"), toolResult("c1", { type: "error-text", value: "e".repeat(MAX_TOOL_RESULT_BYTES + 500) })];
    const out = serializeConversation([], messages);
    const part = (out.messages[2] as { content: Array<{ output: { type: string; value: string } }> }).content[0];
    expect(part.output.type).toBe("error-text");
    expect(part.output.value.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("clamps a transcript tool detail to MAX_TRANSCRIPT_TEXT_CHARS, not MAX_TOOL_RESULT_BYTES", () => {
    const transcript: TranscriptEntry[] = [{ kind: "tool", tool: "run_command", state: "result", detail: "x".repeat(MAX_TOOL_RESULT_BYTES) }];
    const detail = (serializeConversation(transcript, []).transcript[0] as { detail: string }).detail;
    expect(detail.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_TEXT_CHARS + TRUNCATION_MARKER.length);
    expect(detail.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("clamps an oversized user entry's text, bounding the whole transcript", () => {
    const transcript: TranscriptEntry[] = [{ kind: "user", text: "u".repeat(500_000) }];
    const out = serializeConversation(transcript, []);
    expect(JSON.stringify(out.transcript).length).toBeLessThanOrEqual(MAX_TRANSCRIPT_BYTES);
    const text = (out.transcript[0] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_TEXT_CHARS + TRUNCATION_MARKER.length);
    expect(text.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("clamps five oversized assistant entries, bounding the whole transcript", () => {
    const transcript: TranscriptEntry[] = Array.from({ length: 5 }, () => ({
      kind: "assistant" as const, text: "a".repeat(200_000),
    }));
    const out = serializeConversation(transcript, []);
    expect(JSON.stringify(out.transcript).length).toBeLessThanOrEqual(MAX_TRANSCRIPT_BYTES);
    expect(out.transcript).toHaveLength(5);
    for (const e of out.transcript) {
      expect((e as { text: string }).text.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_TEXT_CHARS + TRUNCATION_MARKER.length);
    }
  });

  it("bounds a mixed-kind transcript well over budget", () => {
    const transcript: TranscriptEntry[] = [
      { kind: "user", text: "u".repeat(500_000) },
      { kind: "assistant", text: "a".repeat(300_000) },
      { kind: "tool", tool: "run_command", state: "result", detail: "d".repeat(300_000) },
      { kind: "user", text: "small" },
    ];
    const out = serializeConversation(transcript, []);
    expect(JSON.stringify(out.transcript).length).toBeLessThanOrEqual(MAX_TRANSCRIPT_BYTES);
  });

  it("drops oldest transcript entries until the byte budget fits, keeping the newest", () => {
    const transcript: TranscriptEntry[] = Array.from({ length: 150 }, (_, i) => ({
      kind: "tool" as const, tool: "run_command", state: "result" as const, detail: `entry-${i}-`.padEnd(900, "x"),
    }));
    const out = serializeConversation(transcript, []);
    expect(JSON.stringify(out.transcript).length).toBeLessThanOrEqual(MAX_TRANSCRIPT_BYTES);
    const last = out.transcript[out.transcript.length - 1] as { detail: string };
    expect(last.detail.startsWith("entry-149-")).toBe(true);
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

  it("does not silently empty the history when a leading tool-call part has a missing toolCallId", () => {
    // A bad id in the very first assistant message is the case that zeroes out
    // `lastResolvedEnd` entirely if the id ever lands in `pending`: nothing
    // after it can ever clear a non-string id, so `end` never advances past 0.
    const messages = [
      { role: "assistant", content: [{ type: "tool-call", toolName: "run_command", input: {} }] },
      userMsg("hi"),
      assistantText("ok"),
    ];
    const out = deserializeConversation({ v: 1, transcript: [], messages });
    expect(out?.messages.length).toBeGreaterThan(0);
  });

  it("does not silently empty the history when a leading tool-call part has a non-string toolCallId", () => {
    const messages = [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: 42, toolName: "run_command", input: {} }] },
      userMsg("hi"),
      assistantText("ok"),
    ];
    const out = deserializeConversation({ v: 1, transcript: [], messages });
    expect(out?.messages.length).toBeGreaterThan(0);
  });

  it("filters transcript entries of an unknown kind", () => {
    const out = deserializeConversation({
      v: 1,
      transcript: [{ kind: "user", text: "keep" }, { kind: "bogus" }, { kind: "assistant" }],
      messages: [],
    });
    expect(out?.transcript).toEqual([{ kind: "user", text: "keep" }]);
  });

  describe("malformed messages never throw — returns null or a sanitized result instead", () => {
    const malformed: Array<[string, unknown]> = [
      ["tool message with no content", { role: "tool" }],
      ["tool message with non-array content", { role: "tool", content: "oops" }],
      ["assistant content array with a null part", { role: "assistant", content: [null] }],
      ["tool content array with a null part", { role: "tool", content: [null] }],
      [
        "tool-result part with output: null",
        { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "x", output: null }] },
      ],
      [
        "text output with no value",
        { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "x", output: { type: "text" } }] },
      ],
      [
        "text output with a non-string value",
        { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "x", output: { type: "text", value: 42 } }] },
      ],
    ];

    for (const [label, message] of malformed) {
      it(label, () => {
        expect(() => deserializeConversation({ v: 1, transcript: [], messages: [message] })).not.toThrow();
      });
    }
  });
});
