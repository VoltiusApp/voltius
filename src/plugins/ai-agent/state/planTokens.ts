import { allowlistCandidates, entriesEqual, type AllowlistEntry } from "./allowlist";

/** Caps enforced in `propose_plan`'s zod schema AND again when clamping the
 *  transcript entry, so a hand-edited plugin-data file cannot smuggle a
 *  larger plan past the schema. */
export const MAX_PLAN_STEPS = 20;
export const MAX_PLAN_COMMAND_CHARS = 500;
export const MAX_PLAN_RATIONALE_CHARS = 200;

export type PlanStepTool = "open_session" | "run_command" | "close_session";

export interface PlanStep {
  /** Assigned client-side on receipt — the model does not supply it (it is not
   *  in `propose_plan`'s schema), so ids cannot be forged or collided. */
  id: string;
  tool: PlanStepTool;
  /** Connection id. Steps name a CONNECTION, never a session: in plan mode the
   *  model cannot obtain a session id, so none exists at proposal time. The
   *  binding closes at execution, where `deriveScope` maps the real session
   *  back to its connection id — which is what the token is keyed on. */
  connectionId: string;
  /** `run_command` only. */
  command?: string;
  rationale: string;
}

/**
 * Deliberately only what the store can actually KNOW without threading a step
 * identity through the tool registry and back:
 *
 * - `pending`    — approved but not yet reached.
 * - `dispatched` — its token was consumed, so the call was authorized and sent.
 * - `skipped`    — the plan ended (abandoned / superseded / restored) with this
 *                  step never dispatched.
 *
 * There is deliberately no `ran` / `failed`: whether the command SUCCEEDED is
 * already visible in the ordinary tool transcript entries rendered directly
 * below the card, and claiming an outcome the store never observed would be a
 * guess presented as a record.
 */
export type PlanStepStatus = "pending" | "dispatched" | "skipped";

export type PlanOutcome =
  | "pending" | "approved_run" | "approved_ask" | "rejected"
  /** The run ended (Stop / teardown / supersede / reload) with the plan
   *  unresolved. */
  | "abandoned";

export interface PlanEntryStep extends PlanStep {
  status: PlanStepStatus;
}

export type PlanVerdict =
  | { approve: "run"; steps: PlanStep[] }
  | { approve: "ask"; steps: PlanStep[] }
  | { approve: false; reason?: string };

export interface PlanToken {
  /** Which step minted this token, so consuming it can tick that step's status
   *  without threading a step identity through the tool registry. */
  stepId: string;
  entry: AllowlistEntry;
  used: boolean;
}

export interface PlanBatch {
  /** The generation of the run that proposed the plan. A batch is only ever
   *  honoured while this equals the store's current `runGeneration`, which is
   *  what makes the authority die on newConversation / initAgent / the next
   *  send without any explicit teardown. */
  generation: number;
  /** The transcript entry this batch belongs to, so a consumed token can find
   *  its checklist row. */
  planId: string;
  tokens: PlanToken[];
}

/** The args a step would execute with, in the shape `allowlistCandidates`
 *  reads. `run_command` is keyed on `command`; the others are not
 *  command-carrying, so their args are ignored by the candidate function and
 *  only `scope` matters. */
export function stepArgs(step: PlanStep): Record<string, unknown> {
  return step.tool === "run_command"
    ? { command: step.command ?? "" }
    : { connectionId: step.connectionId };
}

/**
 * The single allowlist entry a step could be pre-authorized by, or `null` when
 * none may be granted.
 *
 * Deliberately the SAME function the approval gate and the approval card use.
 * Minting and matching therefore cannot drift, and three properties are
 * inherited rather than implemented: exact-command keying, connection scoping,
 * and the shell-metacharacter refusal (`isAllowlistable`).
 */
export function stepEntry(step: PlanStep): AllowlistEntry | null {
  return allowlistCandidates(step.tool, stepArgs(step), step.connectionId)[0] ?? null;
}

/** Whether a step can be pre-authorized at all. Drives the "will still ask"
 *  badge, so the UI can never imply authority the gate will not honour. */
export function canPreAuthorize(step: PlanStep): boolean {
  return stepEntry(step) !== null;
}

/** One unused token per pre-authorizable step. A step that cannot mint one is
 *  silently skipped here — the UI is responsible for having told the user, via
 *  `canPreAuthorize`, that it will still ask.
 *
 *  At most one token per `stepId`: a later step sharing an id with an
 *  already-processed one is skipped outright, never re-evaluated. Since a
 *  consumed token's `stepId` is used to tick a checklist row without
 *  threading step identity through the tool registry, a colliding id minting
 *  a second token would make that tick ambiguous — so the id, not just the
 *  entry, is the unit of "one token". */
export function mintTokens(steps: PlanStep[], generation: number, planId: string): PlanBatch {
  const tokens: PlanToken[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) continue;
    seen.add(step.id);
    const entry = stepEntry(step);
    if (entry) tokens.push({ stepId: step.id, entry, used: false });
  }
  return { generation, planId, tokens };
}

/**
 * Consume the first unused token matching `entry`.
 *
 * Pure and synchronous by design. The caller marks the token used inside
 * `approve()` with no intervening `await`, which is what makes "one token, one
 * execution" exact rather than approximate: the AI SDK can dispatch several
 * tool calls from a single step, so two identical calls can be in flight
 * together.
 *
 * Returns the original batch object identity when nothing matched, so a caller
 * can skip a state write. `stepId` is the consumed token's step, for ticking
 * the checklist row.
 */
export function consumeToken(
  batch: PlanBatch,
  entry: AllowlistEntry,
): { batch: PlanBatch; consumed: boolean; stepId?: string } {
  const idx = batch.tokens.findIndex((t) => !t.used && entriesEqual(t.entry, entry));
  if (idx === -1) return { batch, consumed: false };
  const tokens = batch.tokens.map((t, i) => (i === idx ? { ...t, used: true } : t));
  return { batch: { ...batch, tokens }, consumed: true, stepId: batch.tokens[idx].stepId };
}
