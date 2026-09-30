import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { isBlockedTeamVaultStatus, useTeamVaultStateStore, type TeamVaultStatus } from "@/stores/teamVaultStateStore";
import { selectedTeamId } from "@/services/teamVaultFirstAccess";
import { planLapsedFor } from "@/services/permissions";

/** The team vault currently on screen, or null when the selection is not one. */
export function useSelectedTeamId(): string | null {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  return selectedTeamId(selectedVaultIds, vaults, teams);
}

/**
 * The team vault on screen that cannot show its contents, or null. Both shells
 * read this to decide whether to render `TeamVaultStatePanel` in place of the
 * vault's pages, so the selection rule and the blocked statuses live once.
 */
export function useBlockedTeamVault(): { teamId: string; status: TeamVaultStatus } | null {
  const teamId = useSelectedTeamId();
  const status = useTeamVaultStateStore((s) => (teamId ? s.statusByTeamId[teamId] : undefined));

  if (!teamId || !isBlockedTeamVaultStatus(status)) return null;
  return { teamId, status: status! };
}

export type TeamCredentialsReason = "unavailable" | "plan_lapsed";

/**
 * Why the team vault on screen loaded its hosts but not the credentials
 * behind them, or null. The vault is browsable, so this warns in place rather
 * than replacing the page the way a blocked status does (issue #190).
 */
export function useTeamCredentialsUnavailable(): TeamCredentialsReason | null {
  const teamId = useSelectedTeamId();
  const unavailable = useTeamVaultStateStore((s) => (teamId ? s.credentialsUnavailableByTeamId[teamId] ?? false : false));
  const lapsed = useTeamStore((s) => !!teamId && planLapsedFor(s.teams.find((t) => t.id === teamId), s.rolesByTeam[teamId] ?? []));
  if (!unavailable) return null;
  return lapsed ? "plan_lapsed" : "unavailable";
}
