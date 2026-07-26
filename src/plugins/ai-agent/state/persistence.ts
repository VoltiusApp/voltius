import type { ModelMessage } from "ai";
import type { TranscriptEntry } from "./agentStore";
import {
  MAX_PLAN_COMMAND_CHARS,
  MAX_PLAN_ID_CHARS,
  MAX_PLAN_RATIONALE_CHARS,
  MAX_PLAN_STEPS,
  type PlanEntryStep,
  type PlanOutcome,
  type PlanStepStatus,
  type PlanStepTool,
} from "./planTokens";

export const CONVERSATION_KEY = "conversation";
export const CONVERSATION_VERSION = 1;
/** Budget measured as `JSON.stringify(messages).length`. Terminal output is
 * effectively ASCII, so code units track bytes closely enough for a cap whose
 * only job is keeping the shared plugin-data file small. */
export const MAX_MESSAGES_BYTES = 256_000;
export const MAX_TRANSCRIPT_ENTRIES = 200;
export const MAX_TOOL_RESULT_BYTES = 8_000;
/** `tool` `detail` renders as a single-line chip in the drawer, so it's capped
 * far tighter than prose — well below MAX_TOOL_RESULT_BYTES. `user`/`assistant`
 * `text` is full prose and is instead clamped at MAX_TOOL_RESULT_BYTES (see
 * clampTranscript), so a normal reply survives persist uncut and MAX_TRANSCRIPT_BYTES
 * does the real bounding. */
export const MAX_TRANSCRIPT_DETAIL_CHARS = 1_000;
/** Backstop on `JSON.stringify(transcript).length` after the count and
 * per-field caps, since a whole-file rewrite that also carries the allowlist
 * must stay small regardless of how many entries there are or how wide any
 * single field is allowed to be. Bounded ahead of this loop: `user`/`assistant`
 * text (MAX_TOOL_RESULT_BYTES), `tool` detail (MAX_TRANSCRIPT_DETAIL_CHARS),
 * and every plan field — `planId`/`outcome`, and each step's `id`/
 * `connectionId`/`tool`/`status` (MAX_PLAN_ID_CHARS), `command`/`rationale`
 * (MAX_PLAN_COMMAND_CHARS / MAX_PLAN_RATIONALE_CHARS), and step count
 * (MAX_PLAN_STEPS). A plan entry and its steps are built from an explicit
 * field set (see clampPlanStep), so unknown extra keys on either are dropped
 * entirely rather than left unbounded. NOT bounded: `tool.tool` and
 * `attachment.connectionName`, plus any unknown extra key on a `tool`/`user`/
 * `assistant` entry — those still spread and can push a single entry over
 * budget, and the loop below only drops OTHER entries, so it cannot recover
 * from one oversized entry on its own. */
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

const PLAN_TOOLS: PlanStepTool[] = ["open_session", "run_command", "close_session"];
const PLAN_STATUSES: PlanStepStatus[] = ["pending", "dispatched", "skipped"];
const PLAN_OUTCOMES: PlanOutcome[] = ["pending", "approved_run", "approved_ask", "rejected", "abandoned"];

// Built as an explicit field set, never `{ ...s, ... }`: a spread lets any
// unknown key on a persisted step ride through completely unbounded, and
// `tool`/`status` rode through unclamped this way too (validated on the READ
// path via PLAN_TOOLS/PLAN_STATUSES, never touched on the WRITE path). This
// file has now had that exact failure shape three times — closing it
// per-field is how it keeps coming back; only known fields are copied here,
// each one clamped.
function clampPlanStep(s: PlanEntryStep): PlanEntryStep {
  return {
    id: clampToLimit(s.id, MAX_PLAN_ID_CHARS),
    // Model-supplied (see planTokens.ts) — the one identity field that
    // reaches this code without any hand-editing of the plugin-data file.
    connectionId: clampToLimit(s.connectionId, MAX_PLAN_ID_CHARS),
    // Short enums; MAX_PLAN_ID_CHARS is a backstop against corrupted
    // in-memory state, not a semantic limit — legitimate values are a few
    // characters long.
    tool: clampToLimit(s.tool, MAX_PLAN_ID_CHARS) as PlanStepTool,
    command: s.command === undefined ? undefined : clampToLimit(s.command, MAX_PLAN_COMMAND_CHARS),
    rationale: clampToLimit(s.rationale, MAX_PLAN_RATIONALE_CHARS),
    status: clampToLimit(s.status, MAX_PLAN_ID_CHARS) as PlanStepStatus,
  };
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
 * preserve), so once the count and per-field text caps still leave the
 * payload over budget, oldest entries are dropped one at a time until it fits. */
function clampTranscript(transcript: TranscriptEntry[]): TranscriptEntry[] {
  const clamped = transcript
    .map((e) => {
      if (e.kind === "tool") return { ...e, detail: clampToLimit(e.detail, MAX_TRANSCRIPT_DETAIL_CHARS) };
      // A plan entry has no `text`, so it must be handled BEFORE the fallback
      // below — clampToLimit reads `.length` and would throw on undefined.
      // Built as an explicit field set for the same reason as clampPlanStep
      // above: a spread (`...e`) would let an unknown key on the entry itself
      // ride through unbounded.
      if (e.kind === "plan") {
        return {
          kind: "plan" as const,
          planId: clampToLimit(e.planId, MAX_PLAN_ID_CHARS),
          steps: e.steps.slice(0, MAX_PLAN_STEPS).map(clampPlanStep),
          // Short enum; see clampPlanStep's tool/status comment.
          outcome: clampToLimit(e.outcome, MAX_PLAN_ID_CHARS) as PlanOutcome,
        };
      }
      return { ...e, text: clampToLimit(e.text, MAX_TOOL_RESULT_BYTES) };
    })
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

function isValidAttachment(v: unknown): boolean {
  return isRecord(v)
    && typeof v.lineCount === "number"
    && (v.source === "selection" || v.source === "snapshot")
    && typeof v.connectionName === "string"
    && typeof v.truncated === "boolean";
}

function isPlanStep(v: unknown): v is PlanEntryStep {
  if (!isRecord(v)) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (!PLAN_TOOLS.includes(v.tool as PlanStepTool)) return false;
  if (typeof v.connectionId !== "string" || v.connectionId.length === 0) return false;
  if (v.command !== undefined && typeof v.command !== "string") return false;
  if (typeof v.rationale !== "string") return false;
  return PLAN_STATUSES.includes(v.status as PlanStepStatus);
}

function isTranscriptEntry(v: unknown): v is TranscriptEntry {
  if (!isRecord(v)) return false;
  if (v.kind === "user") {
    if (typeof v.text !== "string") return false;
    return v.attachment === undefined || isValidAttachment(v.attachment);
  }
  if (v.kind === "assistant") return typeof v.text === "string";
  if (v.kind === "tool") {
    return typeof v.tool === "string" && typeof v.detail === "string" && (v.state === "call" || v.state === "result");
  }
  if (v.kind === "plan") {
    if (typeof v.planId !== "string" || v.planId.length === 0) return false;
    if (!PLAN_OUTCOMES.includes(v.outcome as PlanOutcome)) return false;
    return Array.isArray(v.steps) && v.steps.every(isPlanStep);
  }
  return false;
}

function isModelMessage(v: unknown): v is ModelMessage {
  if (!isRecord(v)) return false;
  return v.role === "system" || v.role === "user" || v.role === "assistant" || v.role === "tool";
}

/**
 * A restored plan can never be live. Its authority was a promise held by
 * `propose_plan`'s `execute`, and its tokens lived in memory — neither
 * survives a reload. So a persisted `pending` outcome must not render as
 * awaiting approval, and any step still `pending` will now never be
 * dispatched, which is exactly what `skipped` means.
 *
 * This is the SECOND of two independent reasons a restored plan cannot be
 * approved (the first is that `PlanCard` renders read-only unless the entry is
 * the live `pendingPlan`). Both are tested separately so neither rests on the
 * other.
 */
function revivePlan(e: TranscriptEntry): TranscriptEntry {
  if (e.kind !== "plan") return e;
  const steps = e.steps.map((s) => (s.status === "pending" ? { ...s, status: "skipped" as const } : s));
  return e.outcome === "pending" ? { ...e, outcome: "abandoned", steps } : { ...e, steps };
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
  return serializeConversation(raw.transcript.filter(isTranscriptEntry).map(revivePlan), resolved);
}
