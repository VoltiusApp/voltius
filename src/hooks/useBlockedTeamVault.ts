import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { isBlockedTeamVaultStatus, useTeamVaultStateStore, type TeamVaultStatus } from "@/stores/teamVaultStateStore";
import { selectedTeamId } from "@/services/teamVaultFirstAccess";

/**
 * The team vault on screen that cannot show its contents, or null. Both shells
 * read this to decide whether to render `TeamVaultStatePanel` in place of the
 * vault's pages, so the selection rule and the blocked statuses live once.
 */
export function useBlockedTeamVault(): { teamId: string; status: TeamVaultStatus } | null {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const teamId = selectedTeamId(selectedVaultIds, vaults, teams);
  const status = useTeamVaultStateStore((s) => (teamId ? s.statusByTeamId[teamId] : undefined));

  if (!teamId || !isBlockedTeamVaultStatus(status)) return null;
  return { teamId, status: status! };
}
