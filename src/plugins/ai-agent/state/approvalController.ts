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
      // Derived BEFORE the auto shortcut so every approved path carries a
      // connection target to audit against. `scope` feeds only
      // allowlistCandidates; `plan` still returns above without paying for
      // the IPC. No input becomes more permissive because of that move.
      // Exactly one becomes stricter: previously `auto` returned immediately
      // after the mode gate, with no abort check on its path at all; now it
      // runs the re-check below first, so a Stop/supersede landing during
      // this await flips an auto-mode call from approved to denied. The
      // three paths that run after this await — `auto_mode`, `granted` (an
      // existing allowlist entry), and the card path (`addPending` below) —
      // all see that re-check first. `mode` itself was read above, before
      // this await, and is not re-read after it.
      const scope = await deps.deriveScope(call.tool, call.args);
      // Re-checked here — the abort latch only, not `mode`: `deriveScope` is
      // a real IPC round trip, so a call can be parked in the await above at
      // the instant the user hits Stop.
      if (deps.isAborted(generation)) return { approve: false, reason: "aborted" };
      if (mode === "auto") {
        return { approve: true, scope: scope ?? UNKNOWN_SCOPE, via: "auto_mode" };
      }
      // An unresolved scope yields no candidates at all, so it can neither
      // auto-approve nor offer a grant — the fail-closed behaviour 3a
      // established, now expressed in one place instead of three.
      const grants = scope === null ? [] : deps.allowlistCandidates(call.tool, call.args, scope);
      // `scope !== null` here is only type-narrowing for TS — the ternary
      // above already collapses `grants` to `[]` whenever scope is null, so
      // this is not the fail-closed gate; that gate is the line above.
      if (scope !== null && grants.some((g) => deps.hasAllowlist(g))) {
        return { approve: true, scope, via: "granted" };
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
