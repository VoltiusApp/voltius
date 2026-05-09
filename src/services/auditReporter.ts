import type { AuditContext, AuditTarget } from "@/services/auditContext";
import { reportClientEvent } from "@/services/auditService";
import { reportLocalClientEvent } from "@/services/localAuditService";

export type ClientAuditAction = "connection.started" | "connection.ended" | "secret.viewed";

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
