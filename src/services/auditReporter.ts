import type { AuditContext, AuditTarget } from "@/services/auditContext";
import { reportClientEvent } from "@/services/auditService";
import { reportLocalClientEvent } from "@/services/localAuditService";

export type ClientAuditAction =
  | "connection.started" | "connection.ended" | "secret.viewed"
  | "connection.created" | "connection.updated" | "connection.deleted"
  | "identity.created" | "identity.updated" | "identity.deleted"
  | "key.created" | "key.updated" | "key.deleted"
  | "snippet.created" | "snippet.updated" | "snippet.deleted"
  | "folder.created" | "folder.updated" | "folder.deleted"
  | "port_forward.created" | "port_forward.updated" | "port_forward.deleted";

export function reportAuditClientEvent(
  context: AuditContext | null,
  action: ClientAuditAction,
  opts: AuditTarget = {},
): void {
  if (!context) return;

  const event = {
    action,
    ...opts,
    occurred_at: new Date().toISOString(),
  };

  if (context.kind === "team") {
    reportClientEvent(context.teamId, {
      ...event,
      vault_id: opts.vault_id ?? context.vaultId,
    }).catch(() => {});
    return;
  }

  reportLocalClientEvent(context.vaultId, event).catch(() => {});
}
