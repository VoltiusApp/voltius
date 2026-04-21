import { useMemo, useEffect, useState } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { getSyncState, onSyncStateChange } from "@/services/sync";

/**
 * Returns the subset of selectedVaultIds that are currently accessible.
 * Personal vault and local (non-team) vaults are always accessible.
 * Team vaults require an active server connection — when offline they are excluded,
 * ensuring users always see the true server-enforced state (like Discord servers).
 *
 * Server UUIDs stored directly in selectedVaultIds (from standalone team toggles)
 * are also filtered out when that team is already linked to a local vault entry,
 * avoiding double-counting and stale IDs after a vault gets linked.
 */
export function useAccessibleVaultIds(): string[] {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const [cloudActive, setCloudActive] = useState(() => getSyncState().cloudActive);

  useEffect(() => {
    return onSyncStateChange(() => setCloudActive(getSyncState().cloudActive));
  }, []);

  return useMemo(() => {
    const loadedTeamIds = new Set(teams.map((t) => t.id));
    const result: string[] = [];

    for (const vid of selectedVaultIds) {
      if (vid === "personal") { result.push(vid); continue; }
      const vault = vaults.find((v) => v.id === vid);
      if (vault) {
        // Local vault: accessible when local-only or when cloud is active
        if (!vault.teamId || cloudActive) {
          result.push(vid);
          // Also expose the teamId so connections stored with the portable team UUID
          // (written by any account) remain visible to this account.
          if (vault.teamId && cloudActive) result.push(vault.teamId);
        }
      } else {
        // Raw server UUID (standalone team toggle): only valid when cloud is active
        // AND the team is actually present in the loaded teams list.
        // Unknown/stale UUIDs with no matching team are silently excluded.
        if (cloudActive && loadedTeamIds.has(vid)) result.push(vid);
      }
    }

    return result;
  }, [selectedVaultIds, vaults, teams, cloudActive]);
}
