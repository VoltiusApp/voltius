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
  | "agent.action_denied";

export const PLUGIN_AUDIT_ACTIONS: readonly PluginAuditAction[] = [
  "agent.grant_created", "agent.grant_revoked", "agent.mode_changed",
  "agent.session_opened", "agent.session_closed", "agent.command_run",
  "agent.action_denied",
];

export type AnyAuditAction = ClientAuditAction | PluginAuditAction;
