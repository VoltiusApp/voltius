import type { ToolDecision } from "../types";
import type { Mode, PendingApproval } from "./agentStore";
import { UNKNOWN_HOST } from "./hostDerivation";

export interface ApprovalControllerDeps {
  getMode(): Mode;
  hasAllowlist(e: { host: string; key: string }): boolean;
  addPending(p: PendingApproval): void;
  /** `null` means the host could not be determined — must never be treated as allowlistable. */
  deriveHost(tool: string, args: Record<string, unknown>): Promise<string | null>;
  allowlistKey(tool: string, args: Record<string, unknown>): string;
  isAllowlistable(tool: string, args: Record<string, unknown>): boolean;
}

let counter = 0;
const nextId = () => `appr-${++counter}`;

export function createApprovalController(deps: ApprovalControllerDeps) {
  return {
    async approve(call: { tool: string; args: Record<string, unknown> }): Promise<ToolDecision> {
      const mode = deps.getMode();
      if (mode === "plan") {
        return { approve: false, reason: "plan mode — propose this as a step; do not execute" };
      }
      if (mode === "auto") return { approve: true };
      const host = await deps.deriveHost(call.tool, call.args);
      const key = deps.allowlistKey(call.tool, call.args);
      // An unresolved host can never take the allowlist shortcut — compose
      // directly with isAllowlistable rather than a parallel check, so this
      // gate and the card's "Always allow" visibility can't drift apart.
      if (host !== null && deps.isAllowlistable(call.tool, call.args) && deps.hasAllowlist({ host, key })) {
        return { approve: true };
      }
      return new Promise<ToolDecision>((resolve) => {
        deps.addPending({
          id: nextId(),
          tool: call.tool,
          args: call.args,
          host: host ?? UNKNOWN_HOST,
          allowlistKey: key,
          resolve,
        });
      });
    },
  };
}
