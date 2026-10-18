import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useServerBillingEnabled } from "@/services/serverCapabilities";
import { seatReadout, type SeatState } from "@/services/seatMath";

export function useSeatReadout(): SeatState {
  const billingEnabled = useServerBillingEnabled();
  const usedSeats = useSubscriptionStore((s) => s.usedSeats);
  const effectiveSeats = useSubscriptionStore((s) => s.effectiveSeats);
  const totalSeats = useSubscriptionStore((s) => s.totalSeats);
  return seatReadout(usedSeats, effectiveSeats, totalSeats, billingEnabled);
}
