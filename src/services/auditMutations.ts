import { auditContextForVaultId } from "@/services/auditContextResolver";
import { reportAuditClientEvent } from "@/services/auditReporter";

export type AuditObjectType = "connection" | "identity" | "key" | "snippet" | "folder" | "port_forward";
export type AuditMutation = "created" | "updated" | "deleted";

interface AuditMutationTarget {
  id: string;
  name?: string | null;
  vault_id?: string | null;
}

export function reportAuditMutation(
  objectType: AuditObjectType,
  mutation: AuditMutation,
  target: AuditMutationTarget,
  metadata?: Record<string, unknown>,
): void {
  const context = auditContextForVaultId(target.vault_id);
  const vaultId = context.kind === "team" ? context.vaultId : context.vaultId;
  reportAuditClientEvent(context, `${objectType}.${mutation}`, {
    vault_id: vaultId,
    target_type: objectType,
    target_id: target.id,
    target_name: target.name ?? target.id,
    metadata,
  });
}
