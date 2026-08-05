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
  /** True while a plan batch minted by the CURRENT run is live. While it is,
   *  the flat plan-mode refusal is lifted so a call can reach either its token
   *  or an approval card — the "off-plan steps get a card, not a dead end"
   *  contract. */
  planActive(): boolean;
  /** Consume a single-use token matching `entry`. Synchronous: it must not
   *  introduce an await between matching and marking, or two concurrent
   *  identical calls could both be authorized by one token. */
  consumePlanToken(e: AllowlistEntry): boolean;
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
      // While a plan batch is live the flat refusal is lifted: enumerated
      // steps reach their token below, and anything off-plan falls through to
      // an approval card rather than dead-ending the run. `mode` is NOT
      // mutated to achieve this — there is no stored value to unwind, so an
      // abnormally terminated run cannot leave the agent permissive.
      if (mode === "plan" && !deps.planActive()) {
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
      //
      // That non-re-read is a real tradeoff, not a free lunch, and it cuts
      // both ways:
      //   - loosening (`ask` -> `auto` during this await): re-reading would
      //     auto-approve with no card ever having been shown for this call.
      //   - tightening (`auto` -> `ask` during this await): NOT re-reading
      //     means a call the user has just switched to reviewing still
      //     auto-approves below and gets stamped `via: "auto_mode"` — a call
      //     they'd expect a card for goes through unseen.
      // The decision stands anyway: both windows are exactly one IPC round
      // trip wide (this `deriveScope` await), and re-reading here would just
      // trade a fail-closed miss (a card shown when `auto` no longer applies)
      // for a fail-open one (no card when `auto` no longer applies) — not
      // remove the race, only flip which side of it is silent.
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
      // AFTER the standing-allowlist check: a call a real grant already covers
      // reports the durable authority (`granted`) and does not spend a token
      // it never needed. AFTER both isAborted checks and deriveScope, so a
      // token can never authorize a call from a stopped or superseded run —
      // putting this in registry.ts's `gate()` instead would sit downstream of
      // the latch, which is the shape of the bug 3a's third review round fixed.
      // `grants` is already [] when scope is null, so UNKNOWN_SCOPE cannot
      // reach token matching.
      if (scope !== null && grants.some((g) => deps.consumePlanToken(g))) {
        return { approve: true, scope, via: "plan" };
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
