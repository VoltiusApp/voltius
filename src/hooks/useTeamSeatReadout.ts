import { useTeamStore } from "@/stores/teamStore";
import { useSeatReadout } from "@/hooks/useSeatReadout";
import { teamSeatReadout, type SeatState } from "@/services/seatMath";

/** The seats of the team being invited into (its owner's), or the viewer's own when the server does not report them. */
export function useTeamSeatReadout(teamId: string | null | undefined): { seats: SeatState; fromTeam: boolean } {
  const own = useSeatReadout();
  const ownerSeats = useTeamStore((s) => (teamId ? s.teams.find((t) => t.id === teamId)?.ownerSeats : undefined));
  const team = teamSeatReadout(ownerSeats);
  return team ? { seats: team, fromTeam: true } : { seats: own, fromTeam: false };
}
