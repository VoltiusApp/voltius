import { PERM_BITS, isTeamOwner } from "@/services/permissions";

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
  canLeave: boolean;
}

/**
 * Conditions carried over from the former VaultGeneralTab: `cloud` is a
 * standalone team vault with no local row, and "personal" is
 * the built-in vault that must always exist.
 */
export function vaultAdminCapabilities(
  target: VaultAdminTarget,
  teams: { id: string; owner_id: string; role_ids: string[] }[],
  rolesByTeam: Record<string, { id: string; name: string; is_builtin: boolean; permissions?: number }[]>,
  myUserId: string,
): VaultAdminCapabilities {
  const isTeam = !!target.teamId;
  const isLocal = target.kind === "local";

  const team = target.teamId ? teams.find((t) => t.id === target.teamId) : undefined;
  const roles = target.teamId ? rolesByTeam[target.teamId] ?? [] : [];
  const myRoles = (team?.role_ids ?? []).flatMap((rid) => roles.filter((role) => role.id === rid));
  const isOwner = isTeamOwner(team, myUserId);
  const managesVault = myRoles.some((r) => ((r.permissions ?? 0) & (PERM_BITS.MANAGE_VAULT | PERM_BITS.ADMINISTRATOR)) !== 0);

  return {
    isTeam,
    isOwner,
    canRename: isTeam ? isOwner || managesVault : isLocal,
    // The server lets only the owner delete a team, and that deletes it for every member.
    canDelete: isTeam ? isOwner : isLocal && target.vaultId !== "personal",
    canMakePrivate: isTeam && isOwner && isLocal && target.vaultId !== null,
    // The server refuses an owner leaving their own team.
    canLeave: isTeam && !!myUserId && !isOwner,
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
