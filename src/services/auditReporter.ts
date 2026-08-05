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

const MAX_LOCAL_STRING_CHARS = 2000;
const MAX_LOCAL_METADATA_CHARS = 8000;

/**
 * Truncate every over-budget string in a local audit payload and flag it, so a
 * reader is never misled into thinking they see the whole value. Without this one
 * huge value blows MAX_LOCAL_LOG_CHARS_PER_VAULT long before the entry-count cap,
 * and the trim's never-empty guard then keeps only that row, wiping the vault's
 * local history.
 *
 * Per-field truncation alone misses nested and array structures, so the
 * serialized whole is also bounded: over budget (or unserializable, e.g.
 * circular) is dropped entirely rather than left partially truncated and
 * misleading.
 *
 * Applied to the MERGED local payload, so the wire `metadata` parameter is
 * bounded too — it reaches the same local row as `localMetadata`.
 */
export function boundLocalMetadata(
  localMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!localMetadata) return localMetadata;

  let changed = false;
  const bounded: Record<string, unknown> = { ...localMetadata };
  for (const [key, value] of Object.entries(localMetadata)) {
    if (typeof value !== "string" || value.length <= MAX_LOCAL_STRING_CHARS) continue;
    bounded[key] = value.slice(0, MAX_LOCAL_STRING_CHARS);
    bounded[`${key}_truncated`] = true;
    changed = true;
  }

  let serializedLength: number;
  try {
    serializedLength = JSON.stringify(bounded).length;
  } catch {
    return { localMetadata_dropped: true };
  }
  if (serializedLength > MAX_LOCAL_METADATA_CHARS) return { localMetadata_dropped: true };

  return changed ? bounded : localMetadata;
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

  // Re-stamp after the merge AND after bounding so a plugin-supplied
  // localMetadata.plugin_id can't override the host-stamped one and attribution
  // survives a drop (which replaces the payload wholesale).
  const stampedPluginId = target.metadata?.plugin_id;
  const bounded = boundLocalMetadata({ ...target.metadata, ...localMetadata }) ?? {};
  const localMerged = {
    ...bounded,
    ...(stampedPluginId !== undefined ? { plugin_id: stampedPluginId } : {}),
  };
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
