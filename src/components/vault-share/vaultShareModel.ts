import type { TeamRole } from "@/stores/teamStore";

/** Roles an owner may hand out: everything except owner, in the server's order. */
export function assignableRoles(roles: TeamRole[]): TeamRole[] {
  return roles
    .filter((r) => !(r.is_builtin && r.name === "owner"))
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

export type SeatState =
  | { kind: "known"; used: number; total: number; available: number; atLimit: boolean }
  | { kind: "unknown" };

/**
 * A failed subscription load used to render as "? available · ? total".
 * Unknown is its own state so the UI can say so in words.
 */
export function seatState(
  used: number | null | undefined,
  total: number | null | undefined,
): SeatState {
  if (typeof used !== "number" || typeof total !== "number") return { kind: "unknown" };
  const available = Math.max(0, total - used);
  return { kind: "known", used, total, available, atLimit: available <= 0 };
}

const MANAGING_ROLES = new Set(["owner", "manager"]);

export function canManageShare(myRoleNames: string[]): boolean {
  return myRoleNames.some((n) => MANAGING_ROLES.has(n));
}

/** Same gate as the server puts on minting a grant. */
export function canMintLink(myRoleNames: string[]): boolean {
  return canManageShare(myRoleNames);
}
