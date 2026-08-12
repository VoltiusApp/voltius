export type AuditContext =
  | { kind: "team"; teamId: string; vaultId?: string }
  | { kind: "local"; vaultId: string };

export interface AuditTarget {
  vault_id?: string;
  target_type?: string;
  target_id?: string;
  target_name?: string;
  metadata?: Record<string, unknown>;
}

export function auditContextKey(context: AuditContext): string {
  return context.kind === "team" ? `team:${context.teamId}:${context.vaultId ?? ""}` : `local:${context.vaultId}`;
}

export type ClientAuditAction =
  | "connection.started" | "connection.ended" | "secret.viewed"
  | "connection.created" | "connection.updated" | "connection.deleted"
  | "identity.created" | "identity.updated" | "identity.deleted"
  | "key.created" | "key.updated" | "key.deleted"
  | "snippet.created" | "snippet.updated" | "snippet.deleted"
  | "folder.created" | "folder.updated" | "folder.deleted"
  | "port_forward.created" | "port_forward.updated" | "port_forward.deleted";

/**
 * Actions a plugin may record. A closed set, and every member is already on the
 * server's CLIENT_WHITELIST — an unlisted action is rejected with 400 and the
 * client swallows it, so the team trail would go silently empty.
 */
export type PluginAuditAction =
  | "agent.grant_created"
  | "agent.grant_revoked"
  | "agent.mode_changed"
  | "agent.session_opened"
  | "agent.session_closed"
  | "agent.command_run"
  // Real keystrokes, not a shell line: a TUI interaction is not a command run,
  // and a reviewer must be able to tell a C-c from an rm -rf.
  | "agent.keys_sent"
  | "agent.action_denied"
  | "agent.file_created"
  | "agent.file_written"
  | "agent.file_renamed"
  | "agent.file_deleted"
  | "agent.file_transferred"
  | "agent.object_created"
  | "agent.object_updated"
  | "agent.object_deleted"
  // A tool a plugin contributed through api.mcp, called by an external MCP
  // client. Distinct from agent.command_run so the trail stays filterable by
  // what actually reached the host. Must be on the server's CLIENT_WHITELIST
  // before any client that emits it ships, or the team rows are 400ed and
  // silently dropped.
  | "agent.plugin_tool_run";

export const PLUGIN_AUDIT_ACTIONS: readonly PluginAuditAction[] = [
  "agent.grant_created", "agent.grant_revoked", "agent.mode_changed",
  "agent.session_opened", "agent.session_closed", "agent.command_run", "agent.keys_sent",
  "agent.action_denied",
  "agent.file_created", "agent.file_written", "agent.file_renamed",
  "agent.file_deleted", "agent.file_transferred",
  "agent.object_created", "agent.object_updated", "agent.object_deleted",
  "agent.plugin_tool_run",
];

export type AnyAuditAction = ClientAuditAction | PluginAuditAction;
