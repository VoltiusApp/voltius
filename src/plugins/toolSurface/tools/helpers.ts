import type { PluginAuditAction, PluginSession } from "@/plugins/api";
import type { ApprovalVia } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { refusal } from "../refusal";

export type GateResult =
  | { ok: true; args: Record<string, unknown>; scope: string; via: ApprovalVia }
  | { ok: false; result: unknown };

/** Run the approval port for a prompt-risk tool; returns final args or a rejection. */
export function makeGate(ports: ToolSurfacePorts) {
  return async (tool: string, args: Record<string, unknown>): Promise<GateResult> => {
    const decision = await ports.approve({ tool, args });
    if (!decision.approve) return { ok: false, result: refusal("rejected by user", { reason: decision.reason }) };
    return { ok: true, args: decision.args ?? args, scope: decision.scope, via: decision.via };
  };
}

const NO_SUCH_SESSION = () =>
  refusal("no such open session; call list_sessions for the current ids");

type ApprovedGate = Extract<GateResult, { ok: true }>;

export type SessionGateResult =
  | { ok: true; g: ApprovedGate; sessionId: string; session: PluginSession }
  | { ok: false; result: unknown };

/**
 * Approve a verb that acts on an already-open session, checking the session is
 * live on both sides of the gate.
 *
 * Checked twice, deliberately: before the gate, like open_session's
 * guardConnectionId, so a sessionId matching nothing open never raises an
 * approval card for an action that is already doomed; and after it, because an
 * approval can sit pending indefinitely and the user may have closed the
 * session in the meantime.
 *
 * `precheck` runs between the two, for a caller that has its own doomed-call
 * test to make before the card is raised (send_keys parses its key tokens
 * there, so a typo is refused rather than carded). Returning anything truthy
 * short-circuits with that value as the verb's result.
 *
 * HAZARD, and it governs every caller: the returned `g.scope` derives from the
 * ORIGINAL `raw.sessionId` passed to `gate`, not from `g.args.sessionId`, which
 * is the session that actually gets acted on. Those are the same value today
 * only because nothing lets a decision rewrite `sessionId`: the approval card's
 * edit form offers inputs for `command` and `connectionId` only. If `sessionId`
 * ever becomes editable, this must re-derive the scope from the executed
 * session, or a caller's audit record could name a different connection than
 * the one it actually acted on.
 */
export async function sessionGate(
  ports: ToolSurfacePorts,
  gate: ReturnType<typeof makeGate>,
  tool: string,
  raw: Record<string, unknown>,
  precheck?: () => unknown,
): Promise<SessionGateResult> {
  const liveSession = makeLiveSession(ports);
  if (!liveSession(String(raw.sessionId))) {
    return { ok: false, result: NO_SUCH_SESSION() };
  }
  const refused = precheck?.();
  if (refused) return { ok: false, result: refused };

  const g = await gate(tool, raw);
  if (!g.ok) return { ok: false, result: g.result };
  const sessionId = String(g.args.sessionId);
  const session = liveSession(sessionId);
  if (!session) {
    return { ok: false, result: NO_SUCH_SESSION() };
  }
  return { ok: true, g, sessionId, session };
}

/**
 * The wire metadata every session verb's audit row carries. `sessionType` rides
 * on it so the trail distinguishes an action in the user's own terminal from
 * one in an agent workbench; anything that must not leave the device (the shell
 * text, the key tokens) belongs in localMetadata instead.
 */
export function sessionAuditMeta(
  ports: ToolSurfacePorts,
  sg: Extract<SessionGateResult, { ok: true }>,
  tool: string,
): Record<string, unknown> {
  return {
    tool,
    approval: sg.g.via,
    sessionType: sg.session.type,
    ownedByCaller: ports.owned.has(sg.sessionId),
  };
}

/**
 * A partial patch from a verb's parsed arguments: everything the caller sent,
 * minus the id that addressed the object.
 *
 * Zod drops absent optionals rather than filling them with undefined, so what is
 * left is exactly the fields to change — which is what the object domains need
 * to leave the rest of a record alone.
 */
export function toPatch<T>(args: Record<string, unknown>): Partial<T> {
  const { id: _id, ...rest } = args;
  return rest as Partial<T>;
}

/** A currently-open session of any kind, including ones the user opened. */
export function makeLiveSession(ports: ToolSurfacePorts) {
  return (sessionId: string): PluginSession | undefined =>
    ports.api.sessions.list().find((s) => s.id === sessionId);
}

/**
 * Approve, record, then run a mutating file operation.
 *
 * File verbs only — object verbs take secrets as arguments (private keys,
 * passwords); use `objectOp` below instead, which writes no localMetadata.
 *
 * The audit vocabulary is a CLOSED set the team ingest whitelists
 * (server/src/routes/audit.rs) — an unwhitelisted action is 400ed and the
 * client swallows it. Any tool added here needs its action added there first,
 * or its team rows vanish silently. `metadata.tool` stays alongside the
 * action because several tools can share one, and paths are on-device only.
 */
export const FILE_OP_ACTIONS: Record<string, PluginAuditAction> = {
  make_dir: "agent.file_created",
  write_file: "agent.file_written",
  rename_path: "agent.file_renamed",
  delete_path: "agent.file_deleted",
  transfer_file: "agent.file_transferred",
};

export function makeFileOp(ports: ToolSurfacePorts, gate: ReturnType<typeof makeGate>) {
  return async (
    tool: string,
    raw: Record<string, unknown>,
    run: (args: Record<string, unknown>) => Promise<unknown>,
  ): Promise<unknown> => {
    const g = await gate(tool, raw);
    if (!g.ok) return g.result;
    // Before dispatch, like run_command: the operation reaches the filesystem
    // whether or not this call returns, and a mid-flight crash must not erase
    // the record of something that already happened.
    ports.audit(
      g.scope,
      FILE_OP_ACTIONS[tool] ?? "agent.command_run",
      { tool, approval: g.via },
      { args: JSON.stringify(g.args) },
    );
    try {
      return { ok: true, result: (await run(g.args)) ?? null };
    } catch (err) {
      return refusal(err instanceof Error ? err.message : String(err));
    }
  };
}

/**
 * Approve, record, then run a mutating object operation.
 *
 * Object verbs only — file verbs take a path, not a secret; use `makeFileOp`
 * above instead. Unlike fileOp this writes NO localMetadata: object args
 * carry secrets (private keys, passwords) and the local sink is not a place
 * to put them.
 *
 * Records the audit row before dispatch, same tradeoff as makeFileOp: a
 * failed create records a creation that never happened, which is the safe
 * direction to over-record in.
 */
export function objectOp(ports: ToolSurfacePorts, gate: ReturnType<typeof makeGate>) {
  return async (
    tool: string,
    action: PluginAuditAction,
    meta: Record<string, unknown>,
    raw: Record<string, unknown>,
    run: (args: Record<string, unknown>) => Promise<unknown>,
  ): Promise<unknown> => {
    const g = await gate(tool, raw);
    if (!g.ok) return g.result;
    ports.audit(g.scope, action, { tool, approval: g.via, ...meta }, undefined);
    try {
      return { ok: true, result: (await run(g.args)) ?? null };
    } catch (err) {
      return refusal(err instanceof Error ? err.message : String(err));
    }
  };
}

/** The ownership check every MCP write gate uses. */
export function mayAct(ports: ToolSurfacePorts, sessionId: string): boolean {
  return ports.owned.acquire?.(sessionId) ?? ports.owned.has(sessionId);
}
