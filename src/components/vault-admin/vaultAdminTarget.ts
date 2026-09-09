/** What a vault-admin surface acts on. Mirrors `VaultDetail` in VaultsSection. */
export interface VaultAdminTarget {
  kind: "local" | "cloud";
  vaultId: string | null;
  teamId: string | null;
  name: string;
}

export interface VaultAdminCapabilities {
  isTeam: boolean;
  isOwner: boolean;
  canRename: boolean;
  canDelete: boolean;
  canMakePrivate: boolean;
}

/**
 * Conditions carried over from the former VaultGeneralTab: `cloud` is a
 * standalone team vault with no local row to rename or delete, and "personal" is
 * the built-in vault that must always exist. `canDelete` additionally refuses a
 * team vault — see the note on it.
 */
export function vaultAdminCapabilities(
  target: VaultAdminTarget,
  teams: { id: string; role_ids: string[] }[],
  rolesByTeam: Record<string, { id: string; name: string; is_builtin: boolean }[]>,
): VaultAdminCapabilities {
  const isTeam = !!target.teamId;
  const isLocal = target.kind === "local";

  const isOwner = (() => {
    if (!target.teamId) return false;
    const myRoleIds = teams.find((team) => team.id === target.teamId)?.role_ids ?? [];
    const roles = rolesByTeam[target.teamId] ?? [];
    return myRoleIds.some((rid) => {
      const r = roles.find((role) => role.id === rid);
      return r?.is_builtin && r.name === "owner";
    });
  })();

  return {
    isTeam,
    isOwner,
    canRename: isLocal,
    // Delete now takes the vault's contents with it, and a team vault's contents
    // are the members' — held server-side, not this device's to destroy. Making
    // it private first is the step that takes ownership of them; deleting the
    // team is the step that destroys them for everyone. Both are one item up
    // this same menu, so there is nothing to reach that this refusal blocks.
    canDelete: isLocal && !isTeam && target.vaultId !== "personal",
    canMakePrivate: isTeam && isOwner && isLocal && target.vaultId !== null,
  };
}
