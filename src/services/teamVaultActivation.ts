import type { TeamVaultStatus } from "@/stores/teamVaultStateStore";

export interface TeamVaultStatusWriter {
  setStatus: (teamId: string, status: TeamVaultStatus) => void;
}

export function markTeamVaultLoadedAfterLocalActivation(
  teamId: string,
  stateStore: TeamVaultStatusWriter,
): void {
  stateStore.setStatus(teamId, "loaded");
}
