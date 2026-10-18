import type { TFunction } from "i18next";

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

export type SeatState =
  | { kind: "known"; used: number; total: number; available: number; atLimit: boolean }
  | { kind: "unlimited"; used: number }
  | { kind: "unknown" };

export function seatState(
  used: number | null | undefined,
  total: number | null | undefined,
): SeatState {
  if (typeof used !== "number" || typeof total !== "number") return { kind: "unknown" };
  const available = Math.max(0, total - used);
  return { kind: "known", used, total, available, atLimit: available <= 0 };
}

// Billed servers fall back to the purchased count (grandfathered accounts show 3, enforce none);
// unbilled ones sold nothing, so no enforced cap means unlimited.
export function seatReadout(
  used: number | null,
  effectiveSeats: number | null,
  totalSeats: number | null,
  billingEnabled: boolean,
): SeatState {
  if (billingEnabled) return seatState(used, effectiveSeats ?? totalSeats);
  if (effectiveSeats == null && used != null) return { kind: "unlimited", used };
  return seatState(used, effectiveSeats);
}

/** The compact "used / total" form for account rows; `null` when there is nothing to show. */
export function seatsUsedText(t: TFunction, seats: SeatState, usedKey: string): string | null {
  if (seats.kind === "known") return t(usedKey, { used: seats.used, total: seats.total });
  if (seats.kind === "unlimited") return t("members.invite.seatsUnlimited", { used: seats.used });
  return null;
}

export function seatsSummaryText(t: TFunction, seats: SeatState): string {
  switch (seats.kind) {
    case "known":
      return t("members.invite.seatsSummary", { used: seats.used, available: seats.available, total: seats.total });
    case "unlimited":
      return t("members.invite.seatsUnlimited", { used: seats.used });
    case "unknown":
      return t("members.invite.seatsUnknown");
  }
}
