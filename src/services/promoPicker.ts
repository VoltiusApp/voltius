import type { PromoId, PromoState } from "@/services/promos";
import type { SeatTeam, Tier } from "@/stores/subscriptionTier";

export interface PickInput {
  state: PromoState | null;
  billingEnabled: boolean;
  canCheckout: boolean;
  signedIn: boolean;
  tier: Tier;
  billingTier: Tier;
  seatTeam: SeatTeam | null;
  adminComped: boolean;
  /** Milliseconds (Date.now()). `seen[].at` is epoch seconds. */
  now: number;
}

const TEAMS_DELAY_MS = 3 * 86400 * 1000;

export interface PlanEndAccount {
  billingTier: Tier;
  seatTeam: SeatTeam | null;
}

/** A plan that ended only matters to an account still without one; a Pro trial end is
 *  covered by the Pro offer while that is still open. */
function planEndedApplies(state: PromoState, who: PlanEndAccount): boolean {
  if (!state.planEnded || who.billingTier !== "free" || who.seatTeam !== null) return false;
  return !(state.planEnded.kind === "pro_trial" && state.proTrialAvailable);
}

/**
 * Occurrence of the first plan-end notice not yet shown, in modal precedence order
 * (payment issue, plan ended, team ended); null when all are seen or absent.
 */
export function pendingPlanEndOccurrence(state: PromoState, who: PlanEndAccount): number | null {
  const seen = new Set(state.seen.filter((s) => s.promo === "plan_ended").map((s) => s.occurrence));
  const candidates = [
    state.paymentIssue ? (state.paymentIssue.renewsAt ?? 0) : null,
    state.planEnded && planEndedApplies(state, who) ? state.planEnded.at : null,
    state.teamEnded ? state.teamEnded.at : null,
  ];
  for (const occ of candidates) {
    if (occ !== null && !seen.has(occ)) return occ;
  }
  return null;
}

export function pickLaunchPromo(i: PickInput): PromoId | null {
  const { state } = i;
  if (!state || !i.billingEnabled || !i.canCheckout || !i.signedIn || i.adminComped) return null;

  if (pendingPlanEndOccurrence(state, i) !== null) return "plan_ended";

  const shownAt = (promo: PromoId): number[] =>
    state.seen.filter((s) => s.promo === promo).map((s) => s.at * 1000);
  const proShown = shownAt("pro_redeem");
  const teamsShown = shownAt("teams_promo");

  if (state.proTrialAvailable && i.billingTier === "free" && i.seatTeam === null && proShown.length === 0) {
    return "pro_redeem";
  }

  if (
    state.teamsTrialAvailable &&
    teamsShown.length === 0 &&
    i.billingTier !== "teams" &&
    i.billingTier !== "business" &&
    i.seatTeam === null
  ) {
    const proWaited = proShown.length > 0 && proShown.some((at) => i.now - at >= TEAMS_DELAY_MS);
    const noProOffer = !state.proTrialAvailable && proShown.length === 0;
    if (proWaited || noProOffer) return "teams_promo";
  }
  return null;
}
