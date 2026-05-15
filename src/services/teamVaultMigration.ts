export function movedIntoTeamVault(
  previousVaultId: string | null | undefined,
  nextVaultId: string | null | undefined,
  isTeamVaultId: (vaultId: string | null | undefined) => boolean,
): boolean {
  return isTeamVaultId(nextVaultId) && !isTeamVaultId(previousVaultId);
}
