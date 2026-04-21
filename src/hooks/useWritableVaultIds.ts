import { useMemo, useEffect, useState } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { getMyUserId } from "@/services/teamService";

const WRITE_ROLES = new Set(["owner", "manager", "editor"]);

/**
 * Maps a local vault UUID to the stored team ID at save time, so vault_id is
 * portable across accounts.  "personal" is left as-is.
 */
export function resolveVaultIdForSave(vaultId: string): string {
  if (vaultId === "personal") return "personal";
  const vaults = useVaultStore.getState().vaults;
  const vault = vaults.find((v) => v.id === vaultId);
  return vault?.teamId ?? vaultId;
}

/**
 * Returns the single vault ID the current user should default to when creating
 * new items.  Prefers the first writable selected vault; falls back to "personal".
 */
export function useDefaultVaultId(): string {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const membersByTeam = useTeamStore((s) => s.membersByTeam);
  const [myUserId, setMyUserId] = useState("");

  useEffect(() => {
    getMyUserId().then((id) => { if (id) setMyUserId(id); }).catch(() => {});
  }, []);

  return useMemo(() => {
    for (const vid of selectedVaultIds) {
      if (vid === "personal") return vid;
      const vault = useVaultStore.getState().vaults.find((v) => v.id === vid);
      const teamId = vault?.teamId ?? vid;
      // Return the portable team UUID so vault_id is consistent with stored values.
      const resolvedId = vault?.teamId ?? vid;
      const members = membersByTeam[teamId];
      if (!members) {
        // Members not loaded yet — fall back to team-level role cache.
        const myTeam = useTeamStore.getState().teams.find((t) => t.id === teamId);
        if (myTeam) {
          if (WRITE_ROLES.has(myTeam.role)) return resolvedId;
        } else {
          return resolvedId; // optimistic allow while loading
        }
        continue;
      }
      if (!myUserId) {
        // myUserId still loading — use team-level role as fallback.
        const myTeam = useTeamStore.getState().teams.find((t) => t.id === teamId);
        if (myTeam && WRITE_ROLES.has(myTeam.role)) return resolvedId;
        continue;
      }
      const role = members.find((m) => m.user_id === myUserId)?.role ?? "";
      if (WRITE_ROLES.has(role)) return resolvedId;
    }
    return "personal";
  }, [selectedVaultIds, membersByTeam, myUserId]);
}
