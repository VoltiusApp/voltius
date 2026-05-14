import type { Vault } from "@/stores/vaultStore";
import type { Team } from "@/stores/teamStore";

interface DeriveAccessibleVaultIdsInput {
  selectedVaultIds: string[];
  vaults: Vault[];
  teams: Team[];
  cloudActive: boolean;
}

export function deriveAccessibleVaultIds({
  selectedVaultIds,
  vaults,
  teams,
  cloudActive,
}: DeriveAccessibleVaultIdsInput): string[] {
  const loadedTeamIds = new Set(teams.map((t) => t.id));
  const result: string[] = [];

  for (const vid of selectedVaultIds) {
    if (vid === "personal") { result.push(vid); continue; }
    const vault = vaults.find((v) => v.id === vid);
    if (vault) {
      if (!vault.teamId || cloudActive || loadedTeamIds.has(vault.teamId)) {
        result.push(vid);
        if (vault.teamId && (cloudActive || loadedTeamIds.has(vault.teamId))) result.push(vault.teamId);
      }
    } else if (loadedTeamIds.has(vid)) {
      result.push(vid);
    }
  }

  return result;
}
