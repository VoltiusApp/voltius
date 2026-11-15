import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useServerBillingEnabled } from "@/services/serverCapabilities";
import { seatReadout, type SeatState } from "@/services/seatMath";

/** The viewer's own seats, from their subscription. */
export function useSeatReadout(): SeatState {
  const billingEnabled = useServerBillingEnabled();
  const usedSeats = useSubscriptionStore((s) => s.usedSeats);
  const effectiveSeats = useSubscriptionStore((s) => s.effectiveSeats);
  const totalSeats = useSubscriptionStore((s) => s.totalSeats);
  const ownsTeamsPlan = useSubscriptionStore((s) => s.ownsTeamsPlan);
  return seatReadout(usedSeats, effectiveSeats, totalSeats, billingEnabled, !!ownsTeamsPlan);
}
