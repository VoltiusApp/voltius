import { useSubscriptionStore } from "@/stores/subscriptionStore";

export interface SubscriptionView {
  tier: string;
  accountMode: string | null;
  emailVerified: boolean;
  trialEndsAt: string | null;
  trialUsed: boolean;
  isTrialActive: boolean;
  usedSeats: number | null;
  totalSeats: number | null;
  subscriptionStatus: string | null;
  subscriptionCancelled: boolean;
  renewsAt: string | null;
  endsAt: string | null;
  /** Billing enrichment failed: seats and billing lifecycle may be missing or out of date. */
  stale: boolean;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * Rafraîchit puis projette. Toujours `load()`, comme le fait l'écran Account à
 * l'ouverture : un verbe de lecture qui rend un cache d'âge inconnu est un piège.
 * L'enrichissement de facturation peut échouer (réseau, endpoint absent), et
 * `stale` le dit à l'appelant via `billingLoadFailed` du store.
 */
export async function subscription(): Promise<SubscriptionView> {
  await useSubscriptionStore.getState().load();
  const s = useSubscriptionStore.getState();
  return {
    tier: s.tier,
    accountMode: s.accountMode,
    emailVerified: s.emailVerified,
    trialEndsAt: iso(s.trialEndsAt),
    trialUsed: s.trialUsed,
    isTrialActive: s.isTrialActive,
    usedSeats: s.usedSeats,
    totalSeats: s.totalSeats,
    subscriptionStatus: s.subscriptionStatus,
    subscriptionCancelled: s.subscriptionCancelled,
    renewsAt: iso(s.renewsAt),
    endsAt: iso(s.endsAt),
    stale: s.billingLoadFailed,
  };
}
