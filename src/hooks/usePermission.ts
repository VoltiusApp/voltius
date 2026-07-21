import { useCallback, useEffect, useState } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { getMyUserId } from "@/services/teamService";
import {
  resolveCan,
  PERM_BITS,
  effectivePermissions,
  hasBuiltinRole,
  type Permission,
} from "@/services/permissions";

export { PERM_BITS, effectivePermissions, hasBuiltinRole };
export type { Permission };

/**
 * Returns a stable `can(permission, vaultId)` checker.
 * - "personal" always returns true.
 * - Team vaults: OR all assigned role bits and check the requested bit.
 * - Returns false (pessimistic) when data is not yet loaded.
 */
export function usePermissions(): (permission: Permission, vaultId: string) => boolean {
  const teams = useTeamStore((s) => s.teams);
  const membersByTeam = useTeamStore((s) => s.membersByTeam);
  const rolesByTeam = useTeamStore((s) => s.rolesByTeam);
  const loadTeams = useTeamStore((s) => s.loadTeams);
  const loadMembers = useTeamStore((s) => s.loadMembers);
  const loadRoles = useTeamStore((s) => s.loadRoles);
  const [myUserId, setMyUserId] = useState("");

  useEffect(() => {
    getMyUserId().then((id) => { if (id) setMyUserId(id); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (teams.length === 0) { loadTeams().catch(() => {}); return; }
    for (const team of teams) {
      if (!membersByTeam[team.id]) loadMembers(team.id).catch(() => {});
      if (!rolesByTeam[team.id]) loadRoles(team.id).catch(() => {});
    }
  }, [teams, membersByTeam, rolesByTeam, loadTeams, loadMembers, loadRoles]);

  return useCallback((permission: Permission, vaultId: string): boolean => {
    return resolveCan(
      { myUserId, teams, membersByTeam, rolesByTeam, vaults: useVaultStore.getState().vaults },
      permission,
      vaultId,
    );
  }, [teams, membersByTeam, rolesByTeam, myUserId]);
}
