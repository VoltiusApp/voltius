import { useCallback, useEffect, useMemo } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamObjectAccessStore } from "@/stores/teamObjectAccessStore";
import { useMyUserId } from "@/hooks/useMyUserId";
import {
  resolveCan,
  EDIT_PERMISSION_OF,
  PERM_BITS,
  effectivePermissions,
  hasBuiltinRole,
  type Permission,
  type PermissionSnapshot,
} from "@/services/permissions";
import { previewSnapshot, previewSubjectUserId } from "@/services/previewSnapshot";
import { usePreviewStore } from "@/stores/previewStore";
import { useInPreviewContent, usePreviewActive } from "@/hooks/previewScope";
import type { TeamObjectType } from "@/services/teamObjects";

export { PERM_BITS, effectivePermissions, hasBuiltinRole };
export type { Permission };

type Can = (permission: Permission, vaultId: string, objectId?: string) => boolean;
type PermissionInputs = Omit<PermissionSnapshot, "vaults">;
const denyAll: Can = () => false;

function usePermissionInputs(): PermissionInputs {
  const teams = useTeamStore((s) => s.teams);
  const membersByTeam = useTeamStore((s) => s.membersByTeam);
  const rolesByTeam = useTeamStore((s) => s.rolesByTeam);
  const loadTeams = useTeamStore((s) => s.loadTeams);
  const loadMembers = useTeamStore((s) => s.loadMembers);
  const loadRoles = useTeamStore((s) => s.loadRoles);
  const objectAccess = useTeamObjectAccessStore((s) => s.byTeam);
  const myUserId = useMyUserId();

  useEffect(() => {
    if (teams.length === 0) { loadTeams().catch(() => {}); return; }
    for (const team of teams) {
      if (!membersByTeam[team.id]) loadMembers(team.id).catch(() => {});
      if (!rolesByTeam[team.id]) loadRoles(team.id).catch(() => {});
    }
  }, [teams, membersByTeam, rolesByTeam, loadTeams, loadMembers, loadRoles]);

  return useMemo(
    () => ({ myUserId, teams, membersByTeam, rolesByTeam, objectAccess }),
    [myUserId, teams, membersByTeam, rolesByTeam, objectAccess],
  );
}

function useCanOver(inputs: PermissionInputs): Can {
  return useCallback(
    (permission, vaultId, objectId) =>
      resolveCan({ ...inputs, vaults: useVaultStore.getState().vaults }, permission, vaultId, objectId),
    [inputs],
  );
}

/** The signed-in user's own `can`, never substituted by a View-as preview. */
export function useOwnPermissions(): Can {
  return useCanOver(usePermissionInputs());
}

/**
 * Returns a stable `can(permission, vaultId)` checker.
 * - "personal" always returns true.
 * - Team vaults: OR all assigned role bits and check the requested bit.
 * - Returns false (pessimistic) when data is not yet loaded.
 * - Inside the preview content scope, resolves as the previewed subject, denying all until its first result.
 */
export function usePermissions(): Can {
  const own = usePermissionInputs();
  const inContent = useInPreviewContent();
  const session = usePreviewActive();
  const result = usePreviewStore((s) => (inContent ? s.result : null));
  const resultDraft = usePreviewStore((s) => (inContent ? s.resultDraft : null));
  const inputs = useMemo(
    () => (session && result ? previewSnapshot(own, session, resultDraft, result) : own),
    [own, session, resultDraft, result],
  );
  const can = useCanOver(inputs);
  return session && !result ? denyAll : can;
}

export function useHeldPermissionBits(vaultId: string): number {
  const can = usePermissions();
  return (Object.keys(PERM_BITS) as Permission[]).reduce((bits, p) => (can(p, vaultId) ? bits | PERM_BITS[p] : bits), 0);
}

export function usePermissionSubjectId(): string {
  const me = useMyUserId();
  const session = usePreviewActive();
  return session ? previewSubjectUserId(session.subject) : me;
}

/** Whether the caller may edit `object`; a not-yet-saved object is always editable. */
export function useCanEditObject(type: TeamObjectType, object?: { id: string; vault_id?: string }): boolean {
  const can = usePermissions();
  return !object || can(EDIT_PERMISSION_OF[type], object.vault_id || "personal", object.id);
}
