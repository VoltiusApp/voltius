/**
 * Pure resolver: given a vaultId, return the team id it maps to, or null.
 * - A vaultId that IS a team id maps to itself.
 * - Otherwise, look up the vault and use its teamId.
 * Extracted from teamVaultSecrets.resolveTeamIdForVaultId so it can be tested
 * without the zustand stores.
 */
export function resolveTeamIdFromCollections(
  vaultId: string | null | undefined,
  teams: { id: string }[],
  vaults: { id: string; teamId?: string }[],
): string | null {
  if (!vaultId) return null;
  if (teams.some((team) => team.id === vaultId)) return vaultId;
  return vaults.find((vault) => vault.id === vaultId)?.teamId ?? null;
}
