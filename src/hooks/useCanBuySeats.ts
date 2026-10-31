import { CAN_OPEN_CHECKOUT } from "@/services/distribution";
import { useServerBillingEnabled } from "@/services/serverCapabilities";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useTeamStore } from "@/stores/teamStore";
import { useMyUserId } from "@/hooks/useMyUserId";

export function canBuySeats(p: { billingEnabled: boolean; ownsTeamsPlan: boolean; ownerId: string | undefined; myUserId: string }): boolean {
  return p.billingEnabled && CAN_OPEN_CHECKOUT && p.ownsTeamsPlan && !!p.myUserId && p.ownerId === p.myUserId;
}

/** Seats are bought on the billing owner's own subscription, so only that owner may buy them. */
export function useCanBuySeats(teamId: string): boolean {
  const billingEnabled = useServerBillingEnabled();
  const ownsTeamsPlan = useSubscriptionStore((s) => s.ownsTeamsPlan);
  const ownerId = useTeamStore((s) => s.teams.find((t) => t.id === teamId)?.owner_id);
  const myUserId = useMyUserId();
  return canBuySeats({ billingEnabled, ownsTeamsPlan, ownerId, myUserId });
}
