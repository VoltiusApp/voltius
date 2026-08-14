import type { z } from "zod";

export type ToolRisk = "auto" | "prompt";

/** Why a call was allowed. Recorded as `metadata.approval` on the
 *  audit row. `plan` = pre-authorized by a one-shot token minted when
 *  the user approved a plan checklist. Lives in `metadata`, which is
 *  free-form, so this needs no server-side whitelist change. */
export type ApprovalVia = "prompted" | "granted" | "auto_mode" | "plan";

/**
 * Result of an approval request for a prompt-risk tool call.
 *
 * `scope` and `via` are REQUIRED on the approve branch, deliberately: making
 * them optional would let a construction site omit them and produce untargeted
 * audit records that every existing test would still pass.
 */
export type ToolDecision =
  | { approve: true; scope: string; via: ApprovalVia; args?: Record<string, unknown> }
  | { approve: false; reason?: string };

/** The subset of `Set` the tool surface needs for ownership tracking. Lets a
 *  consumer back it with something other than a plain Set — the MCP bridge
 *  backs it with a reactive store so the UI can see provenance. */
export interface OwnedSessions {
  /** Pure: does this caller already own the session. Used by listings. */
  has(sessionId: string): boolean;
  /** May this caller act on the session, adopting an orphan if it is one.
   *  Optional so a bare Set still satisfies the interface in tests; `mayAct`
   *  falls back to `has`. */
  acquire?(sessionId: string): boolean;
  add(sessionId: string): void;
  delete(sessionId: string): boolean;
}

export interface Tool {
  name: string;
  description: string;
  schema: z.ZodType;
  risk: ToolRisk;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

export interface RunCommandResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  /** True when the capture ended without the exit-code marker, so `output` may be partial and `exitCode` is unknown. */
  incomplete: boolean;
}

export interface CaptureOptions {
  timeoutMs?: number;
  quietPeriodMs?: number;
  maxChars?: number;
}

export interface SendKeysResult {
  /** The rendered screen after the output settled. Empty when the session has
   *  no mounted terminal — the write still happened. */
  screen: string;
  /** Output stopped for the quiet period, or never started. False means the
   *  deadline won. */
  settled: boolean;
  /** Any output at all arrived after the write. False distinguishes "the keys
   *  produced nothing" from "the screen settled". */
  outputSeen: boolean;
  timedOut: boolean;
}

export interface SendKeysOptions {
  quietMs?: number;
  /** How long to wait for the FIRST byte before concluding the keys produced
   *  no output (e.g. C-c on an idle shell). */
  firstOutputMs?: number;
  timeoutMs?: number;
  maxLines?: number;
}
