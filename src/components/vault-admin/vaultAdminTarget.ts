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

/**
 * The one place the make-private copy decides between "N other people" and
 * "nobody else". The confirm prompt and the success toast say the same thing
 * about the same team from two different store reads, so the boundary — and the
 * off-by-one that turns a member list into a count of *other* members — lives
 * here rather than being written out at each call site.
 */
export function makePrivateMemberMessage(
  memberCount: number,
  t: (key: string, vars?: { count: number }) => string,
  keys: { others: string; alone: string },
): string {
  return memberCount > 1 ? t(keys.others, { count: memberCount - 1 }) : t(keys.alone);
}
