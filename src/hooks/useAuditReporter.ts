import { useCallback } from "react";
import { reportAuditClientEvent, type ClientAuditAction } from "@/services/auditReporter";
import type { AuditContext, AuditTarget } from "@/services/auditContext";

export function useAuditReporter(context: AuditContext | null) {
  const kind = context?.kind ?? null;
  const teamId = context?.kind === "team" ? context.teamId : null;
  const vaultId = context?.vaultId ?? null;

  return useCallback(
    (action: ClientAuditAction, opts: AuditTarget = {}) => {
      if (!kind) return;
      const auditContext: AuditContext | null = kind === "team"
        ? teamId ? { kind, teamId, vaultId: vaultId ?? undefined } : null
        : vaultId ? { kind, vaultId } : null;
      reportAuditClientEvent(auditContext, action, opts);
    },
    [kind, teamId, vaultId],
  );
}
