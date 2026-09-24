import { useMemo, useEffect, useState } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { vaultById } from "@/services/vaultLookup";
import { useTeamStore } from "@/stores/teamStore";
import { getMyUserId } from "@/services/teamService";
import { effectivePermissions, PERM_BITS } from "@/hooks/usePermission";

/**
 * Maps a local vault UUID to the stored team ID at save time, so vault_id is
 * portable across accounts. A vault with no team keeps its own id.
 */
export function resolveVaultIdForSave(vaultId: string): string {
  return vaultById(useVaultStore.getState().vaults, vaultId)?.teamId ?? vaultId;
}

/**
 * Returns the single vault ID the current user should default to when creating
 * new items.  Prefers the first writable selected vault; falls back to "personal".
 */
export function useDefaultVaultId(): string {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const membersByTeam = useTeamStore((s) => s.membersByTeam);
  const rolesByTeam = useTeamStore((s) => s.rolesByTeam);
  const [myUserId, setMyUserId] = useState("");

  useEffect(() => {
    getMyUserId().then((id) => { if (id) setMyUserId(id); }).catch(() => {});
  }, []);

  return useMemo(() => {
    for (const vid of selectedVaultIds) {
      const vault = vaultById(useVaultStore.getState().vaults, vid);
      if (vault && !vault.teamId) return vid;
      const teamId = vault?.teamId ?? vid;
      const resolvedId = vault?.teamId ?? vid;
      const members = membersByTeam[teamId];
      const roles = rolesByTeam[teamId] ?? [];

      if (!members || !myUserId) {
        // Still loading — check team.role_ids against known roles for a quick answer.
        const myTeam = useTeamStore.getState().teams.find((t) => t.id === teamId);
        if (!myTeam) { return resolvedId; } // optimistic while loading
        const isPrivileged = (myTeam.role_ids ?? []).some((rid) => {
          const r = roles.find((role) => role.id === rid);
          return r?.is_builtin && (r.name === "owner" || r.name === "manager" || r.name === "editor");
        });
        if (isPrivileged || roles.length === 0) return resolvedId; // optimistic when roles not loaded
        continue;
      }

      const member = members.find((m) => m.user_id === myUserId);
      if (!member) continue;
      if (roles.length === 0) return resolvedId; // optimistic while roles loading
      if ((effectivePermissions(member, roles) & PERM_BITS.EDIT_CONNECTIONS) !== 0) return resolvedId;
    }
    return "personal";
  }, [selectedVaultIds, membersByTeam, rolesByTeam, myUserId]);
}
