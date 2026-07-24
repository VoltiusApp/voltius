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
  /** True once the run this call belongs to has been cancelled (Stop /
   * teardown). Consulted at the very top of `approve()`, before the mode
   * gate, and again after the `deriveHost` await — the two points where a
   * call could otherwise slip past a cancellation that happened while it was
   * suspended. */
  isAborted(): boolean;
}

let counter = 0;
const nextId = () => `appr-${++counter}`;

export function createApprovalController(deps: ApprovalControllerDeps) {
  return {
    async approve(call: { tool: string; args: Record<string, unknown> }): Promise<ToolDecision> {
      // Checked before anything else — including the mode gate — so `auto`
      // cannot bypass it: without this, a tool dispatched at the moment of
      // Stop would return {approve:true} with no card and no trace.
      if (deps.isAborted()) return { approve: false, reason: "aborted" };
      const mode = deps.getMode();
      if (mode === "plan") {
        return { approve: false, reason: "plan mode — propose this as a step; do not execute" };
      }
      if (mode === "auto") return { approve: true };
      const host = await deps.deriveHost(call.tool, call.args);
      // Re-checked here: `deriveHost` is a real IPC round trip, so a call can
      // be parked in the await above at the instant the user hits Stop. Both
      // paths below it — the allowlist shortcut and registering a card — run
      // *after* this await, so both must be gated, not just the card path.
      if (deps.isAborted()) return { approve: false, reason: "aborted" };
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
