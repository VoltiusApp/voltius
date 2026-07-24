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
  /** True when an approval issued under `generation` must be refused —
   * either that run was cancelled (Stop / teardown), or the store has moved
   * on to a later generation (a new run, or a fresh activation) that
   * supersedes it. Consulted at the very top of `approve()`, before the mode
   * gate, and again after the `deriveHost` await — the two points where a
   * call could otherwise slip past a cancellation that happened while it was
   * suspended. */
  isAborted(generation: number): boolean;
}

let counter = 0;
const nextId = () => `appr-${++counter}`;

export function createApprovalController(deps: ApprovalControllerDeps) {
  return {
    /**
     * `generation` identifies the run that dispatched this call. It is bound
     * once, by `sendMessage`, before the run can reach this port, and is
     * never re-read from module state here — so a call cannot be
     * re-attributed to a later run (or to a fresh activation) while it is
     * suspended in the `deriveHost` await below. Every gate consults the
     * same immutable value.
     */
    async approve(
      call: { tool: string; args: Record<string, unknown> },
      generation: number,
    ): Promise<ToolDecision> {
      // Checked before anything else — including the mode gate — so `auto`
      // cannot bypass it: without this, a tool dispatched at the moment of
      // Stop, or a straggler from an already-superseded run, would return
      // {approve:true} with no card and no trace.
      if (deps.isAborted(generation)) return { approve: false, reason: "aborted" };
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
      if (deps.isAborted(generation)) return { approve: false, reason: "aborted" };
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
