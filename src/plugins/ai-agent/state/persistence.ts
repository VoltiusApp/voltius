import type { ModelMessage } from "ai";
import type { TranscriptEntry } from "./agentStore";

export const CONVERSATION_KEY = "conversation";
export const CONVERSATION_VERSION = 1;
/** Budget measured as `JSON.stringify(messages).length`. Terminal output is
 * effectively ASCII, so code units track bytes closely enough for a cap whose
 * only job is keeping the shared plugin-data file small. */
export const MAX_MESSAGES_BYTES = 256_000;
export const MAX_TRANSCRIPT_ENTRIES = 200;
export const MAX_TOOL_RESULT_BYTES = 8_000;
/** The transcript's tool `detail` only ever renders as a one-line chip in the
 * drawer, so it doesn't need the fidelity `messages` needs for the model's
 * context — capped far below MAX_TOOL_RESULT_BYTES. */
export const MAX_TRANSCRIPT_DETAIL_CHARS = 1_000;
/** Backstop on `JSON.stringify(transcript).length` after the count and detail
 * caps, since a whole-file rewrite that also carries the allowlist must stay
 * small regardless of how many entries or how wide the count cap is. */
export const MAX_TRANSCRIPT_BYTES = 64_000;
export const TRUNCATION_MARKER = "\n…truncated";

export interface PersistedConversation {
  v: typeof CONVERSATION_VERSION;
  transcript: TranscriptEntry[];
  messages: ModelMessage[];
}

function clampToLimit(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit) + TRUNCATION_MARKER;
}

function clamp(value: string): string {
  return clampToLimit(value, MAX_TOOL_RESULT_BYTES);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Cap oversized tool outputs. A `json` output over budget becomes a truncated
 * `text` output — both are valid `ToolResultOutput`, and truncating inside
 * arbitrary JSON would produce something no longer parseable. */
function clampToolOutputs(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) => {
    if (m.role !== "tool" || !Array.isArray(m.content)) return m;
    return {
      ...m,
      content: m.content.map((part) => {
        if (!isRecord(part as unknown) || part.type !== "tool-result") return part;
        const output: unknown = part.output;
        if (!isRecord(output)) return part;
        if (output.type === "text" || output.type === "error-text") {
          const value = String(output.value ?? "");
          return value.length <= MAX_TOOL_RESULT_BYTES ? part : { ...part, output: { ...output, value: clamp(value) } };
        }
        if (output.type === "json") {
          const encoded = JSON.stringify(output.value ?? null);
          if (encoded.length <= MAX_TOOL_RESULT_BYTES) return part;
          return { ...part, output: { type: "text" as const, value: clamp(encoded) } };
        }
        return part;
      }),
    } as ModelMessage;
  });
}

/** Indices at which a turn begins — every `role: "user"` message. */
function turnStarts(messages: ModelMessage[]): number[] {
  const starts: number[] = [];
  messages.forEach((m, i) => { if (m.role === "user") starts.push(i); });
  return starts;
}

/** Drop whole leading turns until the payload fits. A turn is never split: an
 * assistant tool-call separated from its tool-result is rejected by providers,
 * so a single oversized turn is kept whole rather than cut. */
function capMessages(messages: ModelMessage[]): ModelMessage[] {
  let current = messages;
  let starts = turnStarts(current);
  while (JSON.stringify(current).length > MAX_MESSAGES_BYTES && starts.length > 1) {
    current = current.slice(starts[1]);
    starts = turnStarts(current);
  }
  return current;
}

/** Entries are independent (unlike `messages`, there's no turn structure to
 * preserve), so once the count and detail caps still leave the payload over
 * budget, oldest entries are dropped one at a time until it fits. */
function clampTranscript(transcript: TranscriptEntry[]): TranscriptEntry[] {
  const clamped = transcript
    .map((e) => (e.kind === "tool" ? { ...e, detail: clampToLimit(e.detail, MAX_TRANSCRIPT_DETAIL_CHARS) } : e))
    .slice(-MAX_TRANSCRIPT_ENTRIES);
  let current = clamped;
  while (JSON.stringify(current).length > MAX_TRANSCRIPT_BYTES && current.length > 1) {
    current = current.slice(1);
  }
  return current;
}

export function serializeConversation(
  transcript: TranscriptEntry[],
  messages: ModelMessage[],
): PersistedConversation {
  return {
    v: CONVERSATION_VERSION,
    transcript: clampTranscript(transcript),
    messages: capMessages(clampToolOutputs(messages)),
  };
}

/**
 * Exclusive end index of the longest prefix in which every tool call has a
 * matching tool result. A process killed mid-turn leaves an assistant
 * tool-call with no result, which most providers reject outright — restoring
 * it would brick the conversation on its next send.
 */
function lastResolvedEnd(messages: ModelMessage[]): number {
  const pending = new Set<string>();
  let end = 0;
  messages.forEach((m, i) => {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const part of m.content) {
        if (isRecord(part as unknown) && part.type === "tool-call" && typeof part.toolCallId === "string") {
          pending.add(part.toolCallId);
        }
      }
    }
    if (m.role === "tool" && Array.isArray(m.content)) {
      for (const part of m.content) {
        if (isRecord(part as unknown) && part.type === "tool-result" && typeof part.toolCallId === "string") {
          pending.delete(part.toolCallId);
        }
      }
    }
    if (pending.size === 0) end = i + 1;
  });
  return end;
}

function isTranscriptEntry(v: unknown): v is TranscriptEntry {
  if (!isRecord(v)) return false;
  if (v.kind === "user" || v.kind === "assistant") return typeof v.text === "string";
  if (v.kind === "tool") {
    return typeof v.tool === "string" && typeof v.detail === "string" && (v.state === "call" || v.state === "result");
  }
  return false;
}

function isModelMessage(v: unknown): v is ModelMessage {
  if (!isRecord(v)) return false;
  return v.role === "system" || v.role === "user" || v.role === "assistant" || v.role === "tool";
}

/** Validate, sanitize, and re-cap persisted data. Returns null for anything it
 * cannot trust — the caller then starts empty, the same fail-closed posture the
 * allowlist hydrate uses. */
export function deserializeConversation(raw: unknown): PersistedConversation | null {
  if (!isRecord(raw)) return null;
  if (raw.v !== CONVERSATION_VERSION) return null;
  if (!Array.isArray(raw.transcript) || !Array.isArray(raw.messages)) return null;
  const messages = raw.messages.filter(isModelMessage);
  const resolved = messages.slice(0, lastResolvedEnd(messages));
  return serializeConversation(raw.transcript.filter(isTranscriptEntry), resolved);
}
