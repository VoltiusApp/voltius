export interface SeatAvailability {
  used: number;
  total: number | null;
  available: number | null;
  atLimit: boolean;
}

export function seatAvailability(usedSeats: number | null, totalSeats: number | null): SeatAvailability {
  const used = usedSeats ?? 0;
  const available = totalSeats != null ? Math.max(0, totalSeats - used) : null;
  const atLimit = usedSeats != null && totalSeats != null && usedSeats >= totalSeats;
  return { used, total: totalSeats, available, atLimit };
}

export function seatCost(
  totalSeats: number | null,
  additionalSeats: number,
  pricePerSeat: number,
  defaultTotal = 3,
): { newTotal: number; monthlyCost: number } {
  const currentTotal = totalSeats ?? defaultTotal;
  const newTotal = currentTotal + additionalSeats;
  return { newTotal, monthlyCost: newTotal * pricePerSeat };
}

/**
 * The cap a seat readout should show. `effectiveSeats` is what the server
 * enforces, so it wins whenever it is known; the purchased count is the fallback
 * for the case the server reports no cap at all (an uncapped account, or a
 * server too old to send `effective_seats`), where showing nothing would read as
 * a connection failure. Never use this to decide whether an invite is allowed —
 * that is `seatAvailability(used, effectiveSeats)`, which must not block when the
 * server enforces nothing.
 */
export function displaySeatCap(effectiveSeats: number | null, totalSeats: number | null): number | null {
  return effectiveSeats ?? totalSeats;
}
