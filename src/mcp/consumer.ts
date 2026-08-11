import { z } from "zod";
import type { PluginAPI } from "@/plugins/api";
import { buildCoreTools, deriveScope, type ToolSurfacePorts } from "@voltius/tools";
import { listContributions } from "./contributions";
import { isPluginExposed } from "@/stores/mcpContributionStore";

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
      + "\"local\". Host-to-host streams directly and never lands on the user's machine. A large "
      + "transfer can exceed the call timeout and keep running after the error returns.",
    open_session:
      "Open a new terminal session on a connection. `connectionId` must be an \"id\" from "
      + "list_connections, not a name or a hostname. The session appears as a real tab in the app.",
    run_command:
      "Run a shell command in any open session — one from open_session, or one of the user's own "
      + "from list_sessions — and capture its output + exit code. Runs immediately; your own "
      + "client is responsible for approval. On a serial session the text is sent to the device "
      + "verbatim and there is no exit code.",
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
      + "true; the refusal names what would move and where. Runs immediately; your own client is "
      + "responsible for approval.",
    object_copy:
      "Duplicate objects — connections, keys, identities, snippets or port forwarding rules, "
      + "folders included — into another folder and/or vault, using the same paste path as the "
      + "app's UI. Copying out of a team vault is refused, and copying into a vault other than the "
      + "objects' own is refused unless allow_cross_vault is true; the refusal names what would be "
      + "copied and where. Runs immediately; your own client is responsible for approval.",
    audit_query:
      "Read this device's activity log, newest first — including the rows your own calls "
      + "produced. `action` filters to one exact action name as it appears in a row's `action` "
      + "field. Local rows only; team-vault activity is not returned.",
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

export function buildMcpTools(api: PluginAPI, owned: Set<string>): McpTool[] {
  const ports: ToolSurfacePorts = {
    api,
    // The MCP client's own permission prompt is the gate; Voltius performs no
    // per-call check by construction. `deriveScope` still runs so the audit row
    // names the real connection rather than a constant.
    approve: async ({ tool, args }) => ({
      approve: true,
      scope: (await deriveScope(api, tool, args)) ?? "mcp",
      via: "granted",
      args,
    }),
    audit: (scope, action, metadata, localMetadata) =>
      api.audit?.record?.(scope, action, { ...metadata, via: "mcp" }, localMetadata),
    owned,
    text: MCP_TEXT,
  };
  const core = buildCoreTools(ports).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.schema),
    schema: t.schema,
    execute: (args: Record<string, unknown>) => t.execute(args),
  }));
  return [...core, ...buildContributedTools(ports)];
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
          // exactly one place. `scope` must be a CONNECTION id — api.audit.record
          // resolves the team-vs-local audit context from it, and a session id
          // resolves to nothing and fails closed to the local sink.
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
