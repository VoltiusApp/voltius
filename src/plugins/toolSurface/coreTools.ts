import type { PluginAPI, PluginAuditAction } from "@/plugins/api";
import type { ToolDecision, OwnedSessions } from "./types";

export interface ToolSurfacePorts {
  api: PluginAPI;
  /** Policy. Returns the args to execute plus the scope and provenance the
   *  audit row carries. A consumer approved elsewhere returns approve: true
   *  without prompting. */
  approve(call: { tool: string; args: Record<string, unknown> }): Promise<ToolDecision>;
  /** Called BEFORE dispatch for every mutating tool: the operation reaches the
   *  host whether or not the call returns. */
  audit(
    scope: string,
    action: PluginAuditAction,
    metadata?: Record<string, unknown>,
    localMetadata?: Record<string, unknown>,
  ): void;
  owned: OwnedSessions;
  /** Consumer-specific model-facing text. Absent means the built-in strings,
   *  which describe the agent's approval policy. */
  text?: {
    descriptions?: Record<string, string>;
    notOwnedError?: string;
  };
}

export { buildCoreTools } from "./groups";
