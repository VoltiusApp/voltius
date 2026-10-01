import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";

const namesOf = (teams: { id: string; name: string }[]) => Object.fromEntries(teams.map((t) => [t.id, t.name]));

export function startTeamVaultNames(): () => void {
  useVaultStore.getState().applyTeamNames(namesOf(useTeamStore.getState().teams));
  return useTeamStore.subscribe((s, prev) => {
    if (s.teams !== prev.teams) useVaultStore.getState().applyTeamNames(namesOf(s.teams));
  });
}
