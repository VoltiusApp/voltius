/**
 * First-access behaviour for a team vault (issue #70).
 *
 * Pure helpers only — the owner name the waiting panel shows, the surface a
 * new member should land on, and the rule that maps the vault selection to a
 * team. Kept out of the components so all three are testable without React.
 */

import type { Team, TeamMember } from "@/services/teamService";
import type { Vault } from "@/stores/vaultStore";
import type { NavItem } from "@/stores/uiStore";
import { PERM_BITS } from "@/services/permissions";

/**
 * Handle of the member who owns the team, or null when the roster has not
 * loaded yet or the server predates handles (migration 035). Callers fall back
 * to the generic copy — a blank name flashing into the sentence reads as a bug.
 */
export function ownerHandle(team: Team | undefined, members: TeamMember[] | undefined): string | null {
  if (!team || !members) return null;
  const handle = members.find((m) => m.user_id === team.owner_id)?.handle?.trim();
  return handle ? handle : null;
}

/**
 * Where a first-time member should land in a team vault they just gained.
 *
 * A connect-only invitee holds CONNECT without VIEW_SECRETS: the connection
 * list is the only surface that does anything for them, and the keychain is a
 * wall of redacted rows. Custom roles are covered by the same bit checks rather
 * than by role name.
 */
export function firstViewNav(permissions: number): NavItem {
  if (permissions & PERM_BITS.CONNECT) return "hosts";
  if (permissions & PERM_BITS.VIEW_SECRETS) return "keychain";
  if (permissions & PERM_BITS.MANAGE_MEMBERS) return "members";
  return "hosts";
}

/**
 * The team whose vault is on screen, or null when the selection is not a single
 * team vault. A team can be selected either as a standalone team or through a
 * local vault linked to it.
 */
export function selectedTeamId(
  selectedVaultIds: string[],
  vaults: Vault[],
  teams: Team[],
): string | null {
  if (selectedVaultIds.length !== 1) return null;
  const selected = selectedVaultIds[0];
  const team = teams.find((t) => t.id === selected);
  if (team) return team.id;
  return vaults.find((v) => v.id === selected)?.teamId ?? null;
}
