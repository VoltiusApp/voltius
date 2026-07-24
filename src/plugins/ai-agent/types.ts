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

/** Result of an approval request for a prompt-risk tool call. */
export type ToolDecision =
  | { approve: true; args?: Record<string, unknown> }
  | { approve: false; reason?: string };

export interface RunCommandResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

export interface CaptureOptions {
  timeoutMs?: number;
  quietPeriodMs?: number;
  maxChars?: number;
}
