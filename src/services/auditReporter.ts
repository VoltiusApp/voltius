import type { AuditContext, AuditTarget, ClientAuditAction, PluginAuditAction } from "@/services/auditContext";
import { reportClientEvent } from "@/services/auditService";
import { reportLocalClientEvent } from "@/services/localAuditService";

export type { ClientAuditAction } from "@/services/auditContext";

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

/**
 * Where the LOCAL copy goes. A team context falls back to "personal" rather
 * than its own vault id: auditStore.fetchLogs dispatches local-vs-team on
 * context.kind, so a local row written under a team vault id would be written
 * and never read back.
 */
export function localSinkVaultId(context: AuditContext): string {
  return context.kind === "local" ? context.vaultId : "personal";
}

/**
 * Unlike reportAuditClientEvent, which routes to exactly one sink, this ALWAYS
 * writes the local record and ADDITIONALLY posts for team contexts. The
 * on-device trail is the real security property and must not depend on a
 * server deploy.
 *
 * localMetadata is a separate parameter, not a convention: command text and
 * denial reasons are structurally unable to reach the wire.
 */
export function reportPluginAuditEvent(
  context: AuditContext,
  action: PluginAuditAction,
  opts: AuditTarget & { localMetadata?: Record<string, unknown> } = {},
): void {
  const { localMetadata, ...target } = opts;
  const occurred_at = new Date().toISOString();

  const localMerged = { ...target.metadata, ...localMetadata };
  reportLocalClientEvent(localSinkVaultId(context), {
    ...target,
    action,
    occurred_at,
    metadata: Object.keys(localMerged).length > 0 ? localMerged : undefined,
  }).catch(() => {});

  if (context.kind === "team") {
    reportClientEvent(context.teamId, {
      ...target,
      action,
      occurred_at,
      vault_id: target.vault_id ?? context.vaultId,
    }).catch(() => {});
  }
}
