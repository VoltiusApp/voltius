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
