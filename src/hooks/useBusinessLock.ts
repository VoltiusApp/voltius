import { useTeamStore } from "@/stores/teamStore";
import { isBusinessLocked } from "@/stores/subscriptionTier";
import { isTeamOwner } from "@/services/permissions";
import { useMyUserId } from "@/hooks/useMyUserId";

export function useBusinessLock(teamId: string | null | undefined): { locked: boolean; isOwner: boolean | null } {
  const team = useTeamStore((s) => (teamId ? s.teams.find((t) => t.id === teamId) : undefined));
  const myUserId = useMyUserId();
  return {
    locked: isBusinessLocked(team),
    isOwner: myUserId ? isTeamOwner(team, myUserId) : null,
  };
}
