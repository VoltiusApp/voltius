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
