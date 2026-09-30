import { useTeamStore } from "@/stores/teamStore";
import { tierAtLeast } from "@/stores/subscriptionTier";
import { isTeamOwner } from "@/services/permissions";
import { useMyUserId } from "@/hooks/useMyUserId";

export function useBusinessLock(teamId: string | null | undefined): { locked: boolean; isOwner: boolean } {
  const team = useTeamStore((s) => (teamId ? s.teams.find((t) => t.id === teamId) : undefined));
  const myUserId = useMyUserId();
  return {
    locked: !!team?.owner_tier && !tierAtLeast(team.owner_tier, "business"),
    isOwner: isTeamOwner(team, myUserId),
  };
}
