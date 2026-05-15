export type VaultTransition =
  | { kind: "same-scope" }
  | { kind: "local-to-team"; destinationTeamId: string }
  | { kind: "team-to-team"; sourceTeamId: string; destinationTeamId: string }
  | { kind: "team-to-local"; sourceTeamId: string };

export function classifyVaultTransition(
  previousVaultId: string | null | undefined,
  nextVaultId: string | null | undefined,
  isTeamVaultId: (vaultId: string | null | undefined) => boolean,
): VaultTransition {
  const previousIsTeam = isTeamVaultId(previousVaultId);
  const nextIsTeam = isTeamVaultId(nextVaultId);

  if (!previousIsTeam && nextIsTeam) {
    return { kind: "local-to-team", destinationTeamId: nextVaultId! };
  }

  if (previousIsTeam && nextIsTeam && previousVaultId !== nextVaultId) {
    return { kind: "team-to-team", sourceTeamId: previousVaultId!, destinationTeamId: nextVaultId! };
  }

  if (previousIsTeam && !nextIsTeam) {
    return { kind: "team-to-local", sourceTeamId: previousVaultId! };
  }

  return { kind: "same-scope" };
}

export function movedIntoTeamVault(
  previousVaultId: string | null | undefined,
  nextVaultId: string | null | undefined,
  isTeamVaultId: (vaultId: string | null | undefined) => boolean,
): boolean {
  return classifyVaultTransition(previousVaultId, nextVaultId, isTeamVaultId).kind === "local-to-team";
}
