import type { ToolDecision } from "../types";
import type { Mode, PendingApproval } from "./agentStore";
import { UNKNOWN_SCOPE } from "./scopeDerivation";
import type { AllowlistEntry } from "./allowlist";

export interface ApprovalControllerDeps {
  getMode(): Mode;
  hasAllowlist(e: AllowlistEntry): boolean;
  addPending(p: PendingApproval): void;
  /** `null` means the scope could not be determined — must never be treated as allowlistable. */
  deriveScope(tool: string, args: Record<string, unknown>): Promise<string | null>;
  /** Every entry that would authorize this call; `[]` when nothing may be granted. */
  allowlistCandidates(tool: string, args: Record<string, unknown>, scope: string): AllowlistEntry[];
  /** True when an approval issued under `generation` must be refused —
   * either that run was cancelled (Stop / teardown), or the store has moved
   * on to a later generation (a new run, or a fresh activation) that
   * supersedes it. Consulted at the very top of `approve()`, before the mode
   * gate, and again after the `deriveScope` await — the two points where a
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
     * suspended in the `deriveScope` await below. Every gate consults the
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
      const scope = await deps.deriveScope(call.tool, call.args);
      // Re-checked here: `deriveScope` is a real IPC round trip, so a call can
      // be parked in the await above at the instant the user hits Stop. Both
      // paths below it — the allowlist shortcut and registering a card — run
      // *after* this await, so both must be gated, not just the card path.
      if (deps.isAborted(generation)) return { approve: false, reason: "aborted" };
      // An unresolved scope yields no candidates at all, so it can neither
      // auto-approve nor offer a grant — the fail-closed behaviour 3a
      // established, now expressed in one place instead of three.
      const grants = scope === null ? [] : deps.allowlistCandidates(call.tool, call.args, scope);
      if (grants.some((g) => deps.hasAllowlist(g))) {
        return { approve: true };
      }
      return new Promise<ToolDecision>((resolve) => {
        deps.addPending({
          id: nextId(),
          tool: call.tool,
          args: call.args,
          scope: scope ?? UNKNOWN_SCOPE,
          grants,
          resolve,
        });
      });
    },
  };
}
