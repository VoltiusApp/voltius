export type ProviderKind = "anthropic" | "openai-compatible" | "ollama" | "google";

export interface ProviderProfile {
  id: string;
  providerKind: ProviderKind;
  label: string;
  /** Present only for openai-compatible + ollama. Host root, no trailing path. */
  baseUrl?: string;
  model: string;
}

export type { ToolRisk, ApprovalVia, ToolDecision } from "@voltius/tools";
