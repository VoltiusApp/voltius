import type { ToolDecision } from "../types";
import type { Mode, PendingApproval } from "./agentStore";

export interface ApprovalControllerDeps {
  getMode(): Mode;
  hasAllowlist(e: { host: string; key: string }): boolean;
  addPending(p: PendingApproval): void;
  deriveHost(tool: string, args: Record<string, unknown>): Promise<string>;
  allowlistKey(tool: string, args: Record<string, unknown>): string;
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
      if (deps.hasAllowlist({ host, key })) return { approve: true };
      return new Promise<ToolDecision>((resolve) => {
        deps.addPending({
          id: nextId(),
          tool: call.tool,
          args: call.args,
          host,
          allowlistKey: key,
          resolve,
        });
      });
    },
  };
}
