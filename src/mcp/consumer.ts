import { z } from "zod";
import type { PluginAPI } from "@/plugins/api";
import { buildCoreTools, deriveScope, type ToolSurfacePorts } from "@voltius/tools";

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

export function buildMcpTools(api: PluginAPI): McpTool[] {
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
    owned: new Set<string>(),
    text: MCP_TEXT,
  };
  return buildCoreTools(ports).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.schema),
    schema: t.schema,
    execute: (args) => t.execute(args),
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
    return { ok: true, result: await tool.execute(parsed.data as Record<string, unknown>) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
