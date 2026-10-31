import { useTeamStore } from "@/stores/teamStore";
import type { SeatTeam } from "@/stores/subscriptionTier";
import type { Team } from "@/services/teamService";

export const acme: SeatTeam = { id: "t1", trial: false };

export function nameSeatTeam(name = "Acme"): void {
  useTeamStore.setState({ teams: [{ id: acme.id, name } as Team] });
}

export function forgetTeams(): void {
  useTeamStore.setState({ teams: [] });
}
