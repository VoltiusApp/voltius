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
  has(sessionId: string): boolean;
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
