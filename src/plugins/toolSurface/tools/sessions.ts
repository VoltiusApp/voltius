import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { captureCommand, sendSerialCommand } from "../capture";
import { guardConnectionId } from "../connectionGuard";
import { makeGate, makeLiveSession } from "./helpers";

export const SESSION_PERMISSIONS = [
  "sessions:read", "sessions:write", "terminal:read", "terminal:stream", "terminal:write",
  "connections:read", "audit",
] as const;

export function buildSessionTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const liveSession = makeLiveSession(ports);

  return [
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
          return { error: ports.text?.notOwnedError ?? "session not owned by agent; call open_session first" };
        }
        const g = await gate("close_session", raw);
        if (!g.ok) return g.result;
        const sessionId = String(g.args.sessionId);
        if (!ports.owned.has(sessionId)) {
          return { error: ports.text?.notOwnedError ?? "session not owned by agent; call open_session first" };
        }
        await ports.api.sessions.close(sessionId);
        ports.owned.delete(sessionId);
        ports.audit(g.scope, "agent.session_closed", { tool: "close_session", approval: g.via });
        return { closed: sessionId };
      },
    },
  ];
}
