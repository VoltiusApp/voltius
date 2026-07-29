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
