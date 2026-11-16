import type { Can } from "@/services/credentialScope";

export type PreviewLockedArea = "logs" | "sessions";

export interface PreviewLockContext {
  previewing: boolean;
  can: Can;
  auditTeamId: string | null;
  vaultId: string | null;
}

export function previewAreaLock(area: PreviewLockedArea, { previewing, can, auditTeamId, vaultId }: PreviewLockContext): string | null {
  if (!previewing) return null;
  if (area === "logs") {
    return auditTeamId !== null && !can("VIEW_AUDIT_LOG", auditTeamId) ? "members.viewAs.locked.auditLog" : null;
  }
  return vaultId !== null && !can("VIEW_TERMINAL_SESSIONS", vaultId) ? "members.viewAs.locked.sessions" : null;
}
