import { z } from "zod";
import type { PluginAPI } from "@/plugins/api";
import { buildCoreTools, deriveScope, type ToolSurfacePorts, type OwnedSessions } from "@voltius/tools";
import { listContributions } from "./contributions";
import { isPluginExposed } from "@/stores/mcpContributionStore";
import { useTransferQueueStore } from "@/stores/transferQueueStore";
import type { McpOwner } from "@/stores/mcpOwnershipStore";
import { setTransferId, takeTransferId } from "./transferIdByArgs";

/** The built-in strings describe the agent's approval policy. Over MCP nothing
 *  prompts, so repeating them would misinform the model about the gate. */
export const MCP_TEXT = {
  descriptions: {
    list_sessions:
      "List the terminal sessions that are open right now, including the user's own local shells "
      + "and serial devices — not only sessions this MCP server opened. Use an entry's `id` as "
      + "`sessionId` for run_command and read_terminal; there is no need to call open_session for "
      + "a session that already appears here.",
    make_dir:
      "Create a directory on a file target. Runs immediately; your own client is responsible for "
      + "approval.",
    write_file:
      "Write text to a path on a file target, replacing it if it exists. Runs immediately; your "
      + "own client is responsible for approval.",
    rename_path:
      "Rename or move a path within one file target. Runs immediately; your own client is "
      + "responsible for approval.",
    delete_path:
      "Delete a file or directory on a file target. Runs immediately and cannot be undone; your "
      + "own client is responsible for approval.",
    transfer_file:
      "Copy a file or directory between any two file targets — host to host, or to and from "
      + "\"local\". Host-to-host streams directly and never lands on the user's machine. The "
      + "transfer appears in the user's transfer queue, marked as yours, and can be followed with "
      + "transfer_list. A large transfer can exceed the call timeout and keep running after the "
      + "error returns; use transfer_list to see how it ended.",
    open_session:
      "Open a new terminal session on a connection. `connectionId` must be an \"id\" from "
      + "list_connections, not a name or a hostname. The session appears as a real tab in the app.",
    run_command:
      "Run a shell command in any open session — one from open_session, or one of the user's own "
      + "from list_sessions — and capture its output + exit code. Runs immediately; your own "
      + "client is responsible for approval. On a serial session the text is sent to the device "
      + "verbatim and there is no exit code.",
    send_keys:
      "Send real keystrokes to an open session and return the screen once it settles. Use this for "
      + "full-screen terminal programs (top, less, fzf, vim, whiptail) that run_command cannot "
      + "drive: run_command wraps its input so it can read an exit code, and that wrapper is typed "
      + "into such a program as literal text. Each item of `keys` is either literal text or one key "
      + "name: Enter, Tab, Escape, Space, Backspace, Delete, Insert, Up, Down, Left, Right, Home, "
      + "End, PageUp, PageDown, ShiftTab, F1-F12, C-<char> for control, M-<char> for meta. Names "
      + "match exactly and are case-sensitive; prefix a literal that collides with a name as "
      + "\"lit:Enter\". Runs immediately; your own client is responsible for approval.",
    read_terminal:
      "Read the last N lines of a terminal session's buffer — any open session, including the "
      + "user's own.",
    close_session:
      "Close a session this MCP server opened. Sessions the user opened cannot be closed.",
    key_create:
      "Save an SSH key pair in the vault. `privateKey` is the full PEM/OpenSSH text. Runs "
      + "immediately; your own client is responsible for approval.",
    key_delete:
      "Delete a saved SSH key by id. Runs immediately and cannot be undone; any connection using "
      + "the key will stop authenticating. Your own client is responsible for approval.",
    key_add_to_host:
      "Append an SSH key's public half to a host's authorized_keys over SSH, using the "
      + "connection's stored credentials. This writes to the remote machine. Runs immediately; "
      + "your own client is responsible for approval.",
    identity_create:
      "Create an identity: a username, and optionally the id of a key from key_list. Runs "
      + "immediately; your own client is responsible for approval.",
    identity_delete:
      "Delete a saved identity by id. Runs immediately; connections referencing it will fall back "
      + "to their own username. Your own client is responsible for approval.",
    connection_create:
      "Save a new connection. Runs immediately; your own client is responsible for approval.",
    connection_update:
      "Change fields on a saved connection. Runs immediately; your own client is responsible for "
      + "approval. A connection owned by a team vault cannot be changed.",
    connection_delete:
      "Delete a saved connection by id. Runs immediately and cannot be undone; your own client is "
      + "responsible for approval. A connection owned by a team vault cannot be deleted.",
    connection_bulk_import:
      "Save many connections at once. Runs immediately; your own client is responsible for approval.",
    object_move:
      "Move objects — connections, keys, identities, snippets or port forwarding rules, folders "
      + "included — into another folder and/or vault, using the same paste path as the app's UI. "
      + "Moving into a vault other than the objects' own is refused unless allow_cross_vault is "
      + "true; the refusal names what would move and where. Returns the destination vault and "
      + "folder it wrote to. Runs immediately; your own client is responsible for approval.",
    object_copy:
      "Duplicate objects — connections, keys, identities, snippets or port forwarding rules, "
      + "folders included — into another folder and/or vault, using the same paste path as the "
      + "app's UI. Copying out of a team vault is refused, and copying into a vault other than the "
      + "objects' own is refused unless allow_cross_vault is true; the refusal names what would be "
      + "copied and where. Returns the destination vault and folder it wrote to. Runs "
      + "immediately; your own client is responsible for approval.",
    snippet_create:
      "Save a new snippet. `steps` run in order: a \"script\" step is shell text, a \"transfer\" "
      + "step copies a path between local and remote, and a \"snippet\" step runs another saved "
      + "snippet by id. Runs immediately; your own client is responsible for approval.",
    snippet_update:
      "Change fields on a saved snippet. Only the fields given are altered; `steps` replaces the "
      + "whole sequence. Runs immediately; your own client is responsible for approval. A snippet "
      + "in a team vault cannot be changed.",
    snippet_delete:
      "Delete a saved snippet by id. Runs immediately and cannot be undone; your own client is "
      + "responsible for approval. A snippet in a team vault cannot be deleted.",
    port_forward_create:
      "Save a new port forwarding rule. `tunnel_type` is \"local\" (a port on this machine reaches "
      + "a remote address), \"remote\" (the reverse) or \"dynamic\" (a SOCKS proxy). Saving does not "
      + "open anything — use port_forward_start. Runs immediately; your own client is responsible "
      + "for approval.",
    port_forward_update:
      "Change fields on a saved port forwarding rule. Only the fields given are altered. Runs "
      + "immediately; your own client is responsible for approval. A rule in a team vault cannot be "
      + "changed, and a tunnel already open keeps the shape it started with.",
    port_forward_delete:
      "Delete a saved port forwarding rule by id. Runs immediately and cannot be undone; your own "
      + "client is responsible for approval. A rule in a team vault cannot be deleted, and a tunnel "
      + "already open from it keeps running.",
    port_forward_start:
      "Open a saved rule's tunnel on an open session. This binds a listening socket on the user's "
      + "machine (or on the remote host for a \"remote\" rule) until the tunnel is stopped or the "
      + "session closes. `sessionId` is an id from list_sessions. Runs immediately; your own client "
      + "is responsible for approval. Returns the tunnel, including the id port_forward_stop takes.",
    port_forward_stop:
      "Close a tunnel that is open on a session. `tunnelId` is an id from port_forward_tunnels; the "
      + "saved rule it came from is untouched. Runs immediately; your own client is responsible for "
      + "approval.",
    audit_query:
      "Read this device's activity log, newest first — including the rows your own calls "
      + "produced. `action` filters to one exact action name as it appears in a row's `action` "
      + "field. Local rows only; team-vault activity is not returned.",
    pane_split:
      "Put a session you opened into a split pane beside another session, which may be one of the "
      + "user's own. `position` is where the incoming session lands relative to the target. Use "
      + "session_move_to_pane for a session already in a split tab. Runs immediately; your own "
      + "client is responsible for approval.",
    session_move_to_pane:
      "Move a session you opened next to another session, within the same split tab or across tabs. "
      + "Runs immediately; your own client is responsible for approval.",
    pane_detach:
      "Take a session you opened out of its split tab. The session stays open and becomes its own "
      + "tab; use close_session to end it. Runs immediately; your own client is responsible for "
      + "approval.",
    pane_focus:
      "Bring a session's pane to the front so the user sees it, optionally maximizing it within its "
      + "tab. Works on any open session and changes only what is visible. Runs immediately; your "
      + "own client is responsible for approval.",
    member_invite:
      "Invite someone to a team by email, or add an existing user by id — exactly one of the two. "
      + "Requires your team role to allow it. Runs immediately; your own client is responsible for "
      + "approval.",
    member_remove:
      "Remove a member from a team. They lose access to the team vault. Runs immediately; your own "
      + "client is responsible for approval.",
    member_set_role:
      "Replace a member's roles in a team with one role, given as either a role id or a role name "
      + "— member_list reports both for every member. A role that matches neither is refused before "
      + "any role is removed. Runs immediately; your own client is responsible for approval.",
    list_shared_sessions:
      "List the terminal sessions shared with or by you: each one's participants, who currently "
      + "holds control, and who is asking for it. Each row says whether this MCP server opened that "
      + "session itself; share_session, unshare_session and handoff_control act only on those.",
    share_session:
      "Share a session you opened with one or more team vaults, so their members can watch it and "
      + "request control. Refused for a tab with broadcast typing enabled, because the user's own "
      + "keystrokes would reach every participant. Invite links are not offered here — sharing is "
      + "scoped to named team members. Runs immediately; your own client is responsible for approval.",
    unshare_session:
      "Stop sharing a session you opened. Every participant is disconnected from it. Runs "
      + "immediately; your own client is responsible for approval.",
    handoff_control:
      "Give terminal control to a participant who has requested it. Refused when that user has no "
      + "pending request — control is never handed to someone who did not ask for it. Runs "
      + "immediately; your own client is responsible for approval.",
  } as Record<string, string>,
  notOwnedError: "session not opened by this MCP server; call open_session first",
};

export interface McpTool {
  name: string;
  description: string;
  inputSchema: unknown;
  schema: z.ZodType;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

export function buildMcpTools(
  api: PluginAPI,
  owned: OwnedSessions,
  owner?: () => McpOwner | undefined,
): McpTool[] {
  const ports: ToolSurfacePorts = {
    api,
    // The MCP client's own permission prompt is the gate; Voltius performs no
    // per-call check by construction. `deriveScope` still runs so the audit row
    // names its real target — a connection, or the team for the membership
    // verbs — rather than a constant.
    approve: async ({ tool, args }) => ({
      approve: true,
      scope: (await deriveScope(api, tool, args)) ?? "mcp",
      via: "granted",
      args,
    }),
    audit: (scope, action, metadata, localMetadata) =>
      api.audit?.record?.(scope, action, { ...metadata, via: "mcp" }, localMetadata),
    owned,
    transferId: takeTransferId,
    text: MCP_TEXT,
  };
  const core = buildCoreTools(ports).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.schema),
    schema: t.schema,
    execute: t.name === "transfer_file"
      ? (args: Record<string, unknown>) => queueTransfer(args, owner?.(), () => t.execute(args))
      : (args: Record<string, unknown>) => t.execute(args),
  }));
  return [...core, ...buildContributedTools(ports)];
}

/**
 * Put an MCP-started transfer in the app's own queue so the user can see and
 * cancel it, and so transfer_list/cancel/retry cover it. The ownership stamp
 * happens here rather than in PluginAPI: the client's identity only exists at
 * this layer, and a caller-supplied owner on the plugin API would let any
 * plugin forge MCP provenance.
 */
function queueTransfer(
  args: Record<string, unknown>,
  owner: McpOwner | undefined,
  run: () => Promise<unknown>,
): Promise<unknown> {
  const label = `${String(args.fromPath ?? "")} → ${String(args.toPath ?? "")}`;
  // Host-to-host also renders "→" — the queue's arrow only distinguishes
  // "lands on this machine" from everything else, it has no third glyph for
  // "neither end is local".
  const direction = args.toTarget === "local" ? "←" : "→";
  let out: unknown;
  let thrown: unknown;
  let failed = false;
  return useTransferQueueStore
    .getState()
    .runTransfer(label, direction, async (tid) => {
      // The tool's execute() reads this back to pass the queue row's own id
      // into ports.api.sftp.transfer, so the backend emits progress on the
      // channel this row is subscribed to instead of one nobody listens on.
      setTransferId(args, tid);
      try {
        out = await run();
      } catch (err) {
        // Outside makeFileOp's own try/catch (e.g. gate()/audit() throwing):
        // a genuine exception, as opposed to a caught-and-returned refusal.
        // Captured so it can be rethrown below — runTransfer's catch marks
        // the row "error" but never rethrows, so without this the caller
        // would see a silent `undefined` success instead of the failure.
        thrown = err;
        failed = true;
        throw err;
      }
      // makeFileOp never throws — it catches and resolves with a refusal object —
      // so runTransfer's own catch (which marks the row "error") never fires
      // unless we surface the refusal as a throw here. `out` is already captured,
      // so the caller still gets the refusal back untouched below.
      const refusal = refusalMessage(out);
      if (refusal !== null) throw new Error(refusal);
    }, undefined, false, owner)
    .then(() => {
      if (failed) throw thrown;
      return out;
    });
}

/**
 * Contributed tools, wrapped so the HOST writes the audit row. A plugin cannot
 * forget, and a third-party plugin cannot expose destructive verbs that leave
 * no trace.
 *
 * Follows `objectOp`, not `makeFileOp`: no `localMetadata`. A contributed verb's
 * arguments can carry anything the plugin's schema allows, and the local sink is
 * not a place to put it.
 */
function connectionScope(ports: ToolSurfacePorts, args: Record<string, unknown>): string {
  if (typeof args.sessionId !== "string") return "mcp";
  return ports.api.sessions.list().find((s) => s.id === args.sessionId)?.connectionId ?? "mcp";
}

function buildContributedTools(ports: ToolSurfacePorts): McpTool[] {
  return listContributions()
    .filter((c) => isPluginExposed(c.pluginId))
    .map((c) => ({
      name: c.name,
      description: c.description,
      inputSchema: c.inputSchema,
      schema: c.schema,
      execute: async (args: Record<string, unknown>) => {
        if (c.mutating) {
          // Same audit port the core verbs use, so `via: "mcp"` is stamped in
          // exactly one place. `scope` must be a CONNECTION id, or a TEAM id for
          // the membership verbs — api.audit.record resolves the team-vs-local
          // audit context from it, and a session id resolves to nothing and
          // fails closed to the local sink.
          ports.audit(
            connectionScope(ports, args),
            "agent.plugin_tool_run",
            { contributedBy: c.pluginId, tool: c.name },
            undefined,
          );
        }
        return c.execute(args);
      },
    }));
}

export function listToolDescriptors(tools: McpTool[]) {
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export async function callTool(
  tools: McpTool[],
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `unknown tool "${name}"` };
  const parsed = tool.schema.safeParse(args);
  if (!parsed.success) return { ok: false, error: `invalid arguments for "${name}": ${parsed.error.message}` };
  try {
    const result = await tool.execute(parsed.data as Record<string, unknown>);
    const refusal = refusalMessage(result);
    return refusal === null ? { ok: true, result } : { ok: false, error: refusal };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The refusal message of a refused result, or null when the result is data.
 *
 * The gate, `objectOp` and `makeFileOp` catch a refusal and hand it back inside
 * a successful call, which the transport would otherwise report as
 * `isError: false` — a client that trusts the envelope reads "the vault was
 * deleted" when it was refused and is still there.
 *
 * The test is the explicit `refused: true` marker `refusal()` stamps, never the
 * shape of the result. Recognising a refusal by which keys sit beside `error`
 * needs a complete list of them, and that list was already wrong: a
 * `guardConnectionId` rejection carries `connections`, so an unknown
 * `connectionId` was reported to the client as a successful call. A refusal that
 * grows a field now stays a refusal, and the deliberate distinction is kept —
 * an `error` field ALONGSIDE real data, with no marker, is still a success.
 */
function refusalMessage(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const record = result as Record<string, unknown>;
  if (record.refused !== true || typeof record.error !== "string") return null;
  return record.error;
}
