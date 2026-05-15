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

interface MigratableVaultObject {
  id: string;
  vault_id?: string | null;
}

interface MigrateVaultObjectOptions<T extends MigratableVaultObject> {
  previousVaultId: string | null | undefined;
  nextVaultId: string | null | undefined;
  isTeamVaultId: (vaultId: string | null | undefined) => boolean;
  item: T;
  updateLocal: () => Promise<T>;
  saveTeam: (teamId: string, item: T) => Promise<void>;
  removeTeam: (teamId: string, objectId: string) => Promise<void>;
}

export async function migrateVaultObject<T extends MigratableVaultObject>(
  options: MigrateVaultObjectOptions<T>,
): Promise<T> {
  const transition = classifyVaultTransition(
    options.previousVaultId,
    options.nextVaultId,
    options.isTeamVaultId,
  );

  if (transition.kind === "local-to-team") {
    const updated = await options.updateLocal();
    await options.saveTeam(transition.destinationTeamId, updated);
    return updated;
  }

  if (transition.kind === "team-to-team") {
    await options.saveTeam(transition.destinationTeamId, options.item);
    await options.removeTeam(transition.sourceTeamId, options.item.id);
    return options.item;
  }

  if (transition.kind === "team-to-local") {
    const updated = await options.updateLocal();
    await options.removeTeam(transition.sourceTeamId, options.item.id);
    return updated;
  }

  if (options.isTeamVaultId(options.nextVaultId)) {
    await options.saveTeam(options.nextVaultId!, options.item);
    return options.item;
  }

  return options.updateLocal();
}
