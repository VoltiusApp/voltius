import { useTeamStore } from "@/stores/teamStore";

export function useTeamName(teamId: string | null | undefined): string {
  return useTeamStore((s) => s.teams.find((team) => team.id === teamId)?.name ?? "");
}
