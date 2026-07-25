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
 * AI agent actions (#56). Separate from ClientAuditAction because these are
 * reported through reportAgentAuditEvent, which has a different sink model:
 * always local, additionally team, with a metadata split. See
 * auditReporter.reportAgentAuditEvent.
 */
export type AgentAuditAction =
  | "agent.grant_created"
  | "agent.grant_revoked"
  | "agent.mode_changed"
  | "agent.session_opened"
  | "agent.session_closed"
  | "agent.command_run"
  | "agent.action_denied";

export type AnyAuditAction = ClientAuditAction | AgentAuditAction;
