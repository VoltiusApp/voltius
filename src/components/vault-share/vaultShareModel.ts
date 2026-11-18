import type { TeamRole } from "@/stores/teamStore";

export function isOwnerRole(role: Pick<TeamRole, "is_builtin" | "name">): boolean {
  return role.is_builtin && role.name === "owner";
}

/** Roles that may be handed out, in the server's order. Owner only through invitations: links and enrolment tokens are shared. */
export function assignableRoles(roles: TeamRole[], { withOwner = false } = {}): TeamRole[] {
  return roles
    .filter((r) => withOwner || !isOwnerRole(r))
    .sort((a, b) => a.position - b.position);
}

/**
 * The safest possible stand-in when a role choice is ambiguous: whichever
 * assignable role has the least access (highest `position`), never a more
 * privileged one such as "member".
 */
export function leastPrivilegedRole(roles: TeamRole[]): TeamRole | null {
  const sorted = assignableRoles(roles);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

/** The one builtin role an older server reads from an invitation; newer ones read every id in `role_ids`. */
export function invitationRoleName(roles: TeamRole[], roleIds: string[]): string {
  const builtins = roles.filter((r) => r.is_builtin);
  const chosen = roleIds.map((id) => builtins.find((r) => r.id === id)).find((r) => !!r);
  return (chosen ?? leastPrivilegedRole(builtins))?.name ?? "connect-only";
}

const MANAGING_ROLES = new Set(["owner", "manager"]);

export function canManageShare(myRoleNames: string[]): boolean {
  return myRoleNames.some((n) => MANAGING_ROLES.has(n));
}

/** Same gate as the server puts on minting a grant. */
export function canMintLink(myRoleNames: string[]): boolean {
  return canManageShare(myRoleNames);
}
