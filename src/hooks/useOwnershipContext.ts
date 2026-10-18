import { useTeamStore, type TeamMember, type TeamRole } from "@/stores/teamStore";
import { hasBuiltinRole, isPrimaryOwner } from "@/services/permissions";
import { useServerBillingEnabled, useServerMultiOwner } from "@/services/serverCapabilities";
import { useMyUserId } from "@/hooks/useMyUserId";
import type { OwnershipContext } from "@/services/teamOwnership";

export function useOwnershipContext(teamId: string | null, viewer: TeamMember | undefined, roles: TeamRole[]): OwnershipContext {
  const multiOwner = useServerMultiOwner();
  const billingEnabled = useServerBillingEnabled();
  const team = useTeamStore((s) => s.teams.find((t) => t.id === teamId));
  const myUserId = useMyUserId();
  return {
    multiOwner,
    billingEnabled,
    billingOwnerId: team?.owner_id,
    viewerIsOwner: !!viewer && hasBuiltinRole(viewer, "owner", roles),
    viewerIsPrimary: isPrimaryOwner(team, myUserId),
  };
}
