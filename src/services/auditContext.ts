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
