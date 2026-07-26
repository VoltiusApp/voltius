export type ProviderKind = "anthropic" | "openai-compatible" | "ollama" | "google";

export interface ProviderProfile {
  id: string;
  providerKind: ProviderKind;
  label: string;
  /** Present only for openai-compatible + ollama. Host root, no trailing path. */
  baseUrl?: string;
  model: string;
}

export type ToolRisk = "auto" | "prompt";

/** Why a call was allowed. Recorded as `metadata.approval` on agent.command_run.
 *  `plan` = pre-authorized by a one-shot token minted when the user approved a
 *  plan checklist. Lives in `metadata`, which is free-form, so this needs no
 *  server-side whitelist change. */
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
