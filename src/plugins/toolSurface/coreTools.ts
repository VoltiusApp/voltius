import { z } from "zod";
import type { PluginAPI, PluginAuditAction } from "@/plugins/api";
import type { Tool, ToolDecision, ApprovalVia } from "./types";
import { captureCommand, sendSerialCommand } from "./capture";
import { guardConnectionId } from "./connectionGuard";

export interface ToolSurfacePorts {
  api: PluginAPI;
  /** Policy. Returns the args to execute plus the scope and provenance the
   *  audit row carries. A consumer approved elsewhere returns approve: true
   *  without prompting. */
  approve(call: { tool: string; args: Record<string, unknown> }): Promise<ToolDecision>;
  /** Called BEFORE dispatch for every mutating tool: the operation reaches the
   *  host whether or not the call returns. */
  audit(
    scope: string,
    action: PluginAuditAction,
    metadata?: Record<string, unknown>,
    localMetadata?: Record<string, unknown>,
  ): void;
  owned: Set<string>;
}

/** The consumer-agnostic verb set. Planning stays with the consumer that has a UI for it. */
export function buildCoreTools(ports: ToolSurfacePorts): Tool[] {
  /** Run the approval port for a prompt-risk tool; returns final args or a rejection. */
  const gate = async (
    tool: string,
    args: Record<string, unknown>,
  ): Promise<
    | { ok: true; args: Record<string, unknown>; scope: string; via: ApprovalVia }
    | { ok: false; result: unknown }
  > => {
    const decision = await ports.approve({ tool, args });
    if (!decision.approve) return { ok: false, result: { error: "rejected by user", reason: decision.reason } };
    return { ok: true, args: decision.args ?? args, scope: decision.scope, via: decision.via };
  };

  /** A currently-open session of any kind, including ones the user opened. */
  const liveSession = (sessionId: string) =>
    ports.api.sessions.list().find((s) => s.id === sessionId);

  /**
   * Approve, record, then run a mutating file operation.
   *
   * The audit vocabulary is a CLOSED set the team ingest whitelists
   * (server/src/routes/audit.rs) — an unwhitelisted action is 400ed and the
   * client swallows it. Any tool added here needs its action added there first,
   * or its team rows vanish silently. `metadata.tool` stays alongside the
   * action because several tools can share one, and paths are on-device only.
   */
  const FILE_OP_ACTIONS: Record<string, PluginAuditAction> = {
    make_dir: "agent.file_created",
    write_file: "agent.file_written",
    rename_path: "agent.file_renamed",
    delete_path: "agent.file_deleted",
    transfer_file: "agent.file_transferred",
  };

  const fileOp = async (
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
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };

  return [
    {
      name: "list_connections",
      description:
        "List the user's saved SSH/host connections (id, name, host). `team: true` marks one "
        + "shared through a team vault; it is addressable exactly like a personal connection.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => {
        const conns = await ports.api.connections.list();
        return conns.map((c) => ({
          id: c.id, name: c.name, host: c.host, ...(c.team ? { team: true } : {}),
        }));
      },
    },
    {
      name: "list_sessions",
      description:
        "List the terminal sessions that are open right now, including the user's own local shells "
        + "and serial devices — not only sessions this agent opened. Use an entry's `id` as "
        + "`sessionId` for run_command and read_terminal; there is no need to call open_session for "
        + "a session that already appears here.",
      risk: "auto",
      schema: z.object({}),
      execute: async () =>
        ports.api.sessions.list().map((s) => ({
          id: s.id,
          type: s.type,
          status: s.status,
          connectionId: s.connectionId,
          connectionName: s.connectionName,
          localShell: s.localShell,
          agentOwned: ports.owned.has(s.id),
        })),
    },
    {
      name: "list_files",
      description:
        "List a directory on a file target. A target is a connection id from list_connections "
        + "(SSH or FTP), or the literal \"local\" for the user's own machine.",
      risk: "auto",
      schema: z.object({ target: z.string(), path: z.string() }),
      execute: async (raw) => ports.api.sftp.list(String(raw.target), String(raw.path)),
    },
    {
      name: "stat_file",
      description: "Size, type and mtime of one path on a file target. Null when it does not exist.",
      risk: "auto",
      schema: z.object({ target: z.string(), path: z.string() }),
      execute: async (raw) => ports.api.sftp.stat(String(raw.target), String(raw.path)),
    },
    {
      name: "read_file",
      description: "Read a text file from a file target. Large files are truncated.",
      risk: "auto",
      schema: z.object({ target: z.string(), path: z.string(), maxBytes: z.number().int().positive().optional() }),
      execute: async (raw) => ({
        content: await ports.api.sftp.readText(
          String(raw.target),
          String(raw.path),
          raw.maxBytes as number | undefined,
        ),
      }),
    },
    {
      name: "make_dir",
      description: "Create a directory on a file target. Prompts.",
      risk: "prompt",
      schema: z.object({ target: z.string(), path: z.string() }),
      execute: async (raw) => fileOp("make_dir", raw, (a) =>
        ports.api.sftp.mkdir(String(a.target), String(a.path))),
    },
    {
      name: "write_file",
      description: "Write text to a path on a file target, replacing it if it exists. Prompts.",
      risk: "prompt",
      schema: z.object({ target: z.string(), path: z.string(), content: z.string() }),
      execute: async (raw) => fileOp("write_file", raw, (a) =>
        ports.api.sftp.writeText(String(a.target), String(a.path), String(a.content))),
    },
    {
      name: "rename_path",
      description: "Rename or move a path within one file target. Prompts.",
      risk: "prompt",
      schema: z.object({ target: z.string(), from: z.string(), to: z.string() }),
      execute: async (raw) => fileOp("rename_path", raw, (a) =>
        ports.api.sftp.rename(String(a.target), String(a.from), String(a.to))),
    },
    {
      name: "delete_path",
      description:
        "Delete a file or directory on a file target. Prompts every time, and cannot be undone.",
      risk: "prompt",
      schema: z.object({ target: z.string(), path: z.string() }),
      execute: async (raw) => fileOp("delete_path", raw, (a) =>
        ports.api.sftp.delete(String(a.target), String(a.path))),
    },
    {
      name: "transfer_file",
      description:
        "Copy a file or directory between any two file targets — host to host, or to and from "
        + "\"local\". Host-to-host streams directly and never lands on the user's machine. Prompts.",
      risk: "prompt",
      schema: z.object({
        fromTarget: z.string(), fromPath: z.string(),
        toTarget: z.string(), toPath: z.string(),
      }),
      execute: async (raw) => fileOp("transfer_file", raw, (a) =>
        ports.api.sftp.transfer(
          { target: String(a.fromTarget), path: String(a.fromPath) },
          { target: String(a.toTarget), path: String(a.toPath) },
        )),
    },
    {
      name: "open_session",
      description:
        'Open a dedicated agent workbench session on a connection. `connectionId` must be an "id" from list_connections, not a name or a hostname. Prompts the user.',
      risk: "prompt",
      schema: z.object({ connectionId: z.string() }),
      execute: async (raw) => {
        // Before the gate, deliberately: an id that matches no connection can
        // never be scoped or pre-authorized, so carding it would ask the user
        // to authorize an action that is already doomed.
        const guard = await guardConnectionId(ports.api, String(raw.connectionId));
        if (!guard.ok) return guard.result;
        const g = await gate("open_session", raw);
        if (!g.ok) return g.result;
        const connectionId = String(g.args.connectionId);
        const sessionId = await ports.api.sessions.open(connectionId);
        ports.owned.add(sessionId);
        // After the open succeeds: a failed open produced no session, so there
        // is nothing to record.
        ports.audit(g.scope, "agent.session_opened", { tool: "open_session", approval: g.via });
        return { sessionId };
      },
    },
    {
      name: "run_command",
      description:
        "Run a shell command in any open session — one from open_session, or one of the user's own "
        + "from list_sessions — and capture its output + exit code. Prompts for every command. On a "
        + "serial session the text is sent to the device verbatim and there is no exit code.",
      risk: "prompt",
      schema: z.object({ sessionId: z.string(), command: z.string() }),
      execute: async (raw) => {
        // Before the gate, like open_session's guardConnectionId: a sessionId
        // matching nothing open can never run, so carding it would ask the user
        // to authorize an action that is already doomed.
        if (!liveSession(String(raw.sessionId))) {
          return { error: "no such open session; call list_sessions for the current ids" };
        }
        const g = await gate("run_command", raw);
        if (!g.ok) return g.result;
        const sessionId = String(g.args.sessionId);
        const command = String(g.args.command);
        // Re-read after the gate: an approval can sit pending indefinitely, and
        // the user may have closed the session in the meantime.
        const session = liveSession(sessionId);
        if (!session) {
          return { error: "no such open session; call list_sessions for the current ids" };
        }
        // Recorded BEFORE dispatch, deliberately: the command reaches the
        // shell whether or not the capture comes back, and a crash mid-capture
        // must not erase the record of something that actually ran.
        //
        // `g.scope` is derived from `raw.sessionId` (the ORIGINAL args passed
        // to `gate`), not from `g.args.sessionId` (what actually executes,
        // below). Those are the same value today only because nothing lets a
        // decision rewrite `sessionId`: the approval card's edit form offers
        // inputs for `command` and `connectionId` only. If `sessionId` ever
        // becomes editable, this line must re-derive scope from the executed
        // session, or the audit record could name a different connection than
        // the one the command actually ran on.
        ports.audit(
          g.scope,
          "agent.command_run",
          // sessionType rides on the wire metadata so the trail distinguishes a
          // command run in the user's own terminal from one in an agent workbench.
          { tool: "run_command", approval: g.via, sessionType: session.type, agentOwned: ports.owned.has(sessionId) },
          { command },
        );
        return session.type === "serial"
          ? sendSerialCommand(ports.api, sessionId, command, {})
          : captureCommand(ports.api, sessionId, command, {});
      },
    },
    {
      name: "read_terminal",
      description: "Read the last N lines of a terminal session's buffer (the user's session or the workbench).",
      risk: "auto",
      schema: z.object({ sessionId: z.string(), maxLines: z.number().int().positive().optional() }),
      execute: async (raw) => ports.api.terminal.readSnapshot(String(raw.sessionId), raw.maxLines as number | undefined),
    },
    {
      name: "close_session",
      description: "Close an agent-owned workbench session.",
      risk: "prompt",
      schema: z.object({ sessionId: z.string() }),
      execute: async (raw) => {
        if (!ports.owned.has(String(raw.sessionId))) {
          return { error: "session not owned by agent; call open_session first" };
        }
        const g = await gate("close_session", raw);
        if (!g.ok) return g.result;
        const sessionId = String(g.args.sessionId);
        if (!ports.owned.has(sessionId)) return { error: "session not owned by agent; call open_session first" };
        await ports.api.sessions.close(sessionId);
        ports.owned.delete(sessionId);
        ports.audit(g.scope, "agent.session_closed", { tool: "close_session", approval: g.via });
        return { closed: sessionId };
      },
    },
  ];
}
