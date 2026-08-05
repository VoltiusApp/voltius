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

interface DeriveScopedVaultIdInput {
  selectedVaultIds: string[];
  vaults: Vault[];
  accessibleVaultIds: string[];
}

/**
 * The single vault the current view is scoped to, or null when it shows several
 * (or none). A page root is only a vault's root when exactly one vault is on
 * screen; with several there is no destination to name, so anything landing at
 * the root keeps the vault it already has.
 *
 * Returns the id objects actually carry — the team id for a linked team vault,
 * matching `vaultOptions` — and null when the selected vault is not currently
 * accessible, since nothing may be written into an unreachable vault.
 */
export function deriveScopedVaultId({
  selectedVaultIds,
  vaults,
  accessibleVaultIds,
}: DeriveScopedVaultIdInput): string | null {
  if (selectedVaultIds.length !== 1) return null;
  const selected = selectedVaultIds[0];
  const canonical = vaults.find((v) => v.id === selected)?.teamId ?? selected;
  return accessibleVaultIds.includes(canonical) ? canonical : null;
}
