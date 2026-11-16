import type { Can } from "@/services/credentialScope";
import type { AuditContext } from "@/services/auditContext";

export type PreviewAreaLockQuery = { previewing: boolean; can: Can } & (
  | { area: "logs"; auditContext: AuditContext | null }
  | { area: "sessions"; vaultId: string | null }
);

export function previewAreaLock(q: PreviewAreaLockQuery): string | null {
  if (!q.previewing) return null;
  if (q.area === "logs") {
    const teamId = q.auditContext?.kind === "team" ? q.auditContext.teamId : null;
    return teamId !== null && !q.can("VIEW_AUDIT_LOG", teamId) ? "members.viewAs.locked.auditLog" : null;
  }
  return q.vaultId !== null && !q.can("VIEW_TERMINAL_SESSIONS", q.vaultId) ? "members.viewAs.locked.sessions" : null;
}
