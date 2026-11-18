import { serverFetch } from "@/services/teamService";
import { refreshAccessToken } from "@/services/authTokens";
import { EMAIL_VERIFICATION_REQUIRED_EVENT, openBillingCheckout } from "@/services/billingCheckout";
import { CAN_OPEN_CHECKOUT } from "@/services/distribution";
import { getServerCapability } from "@/services/serverCapabilities";
import { checkoutRequiresEmailVerification } from "@/utils/emailVerification";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { usePromoStore } from "@/stores/promoStore";

export type PromoId = "pro_redeem" | "teams_promo" | "plan_ended";
export type PromoEvent = "shown" | "dismissed" | "clicked";
export type PromoSource =
  | "launch"
  | "vault_limit"
  | "sync_provider"
  | "teams_gate"
  | "account"
  | "titlebar"
  | "mobile_account";
export type PaywallContext = "vaults" | "sync" | "team";

/** All timestamps are epoch seconds, as the server sends them. */
export interface PromoState {
  proTrialAvailable: boolean;
  teamsTrialAvailable: boolean;
  emailVerified: boolean;
  seen: { promo: PromoId; source: string; occurrence: number | null; at: number }[];
  planEnded: { kind: "pro_trial" | "teams_trial" | "subscription"; at: number } | null;
  teamEnded: { teamId: string; teamName: string; at: number } | null;
  paymentIssue: { status: "past_due" | "unpaid"; renewsAt: number | null } | null;
}

interface PromoStateWire {
  pro_trial_available: boolean;
  teams_trial_available: boolean;
  email_verified: boolean;
  seen?: PromoState["seen"];
  plan_ended?: PromoState["planEnded"];
  team_ended?: { team_id: string; team_name: string; at: number } | null;
  payment_issue?: { status: "past_due" | "unpaid"; renews_at: number | null } | null;
}

function fromWire(w: PromoStateWire): PromoState {
  return {
    proTrialAvailable: w.pro_trial_available === true,
    teamsTrialAvailable: w.teams_trial_available === true,
    emailVerified: w.email_verified === true,
    seen: (w.seen ?? []).map((s) => ({ promo: s.promo, source: s.source, occurrence: s.occurrence ?? null, at: s.at })),
    planEnded: w.plan_ended ? { kind: w.plan_ended.kind, at: w.plan_ended.at } : null,
    teamEnded: w.team_ended ? { teamId: w.team_ended.team_id, teamName: w.team_ended.team_name, at: w.team_ended.at } : null,
    paymentIssue: w.payment_issue
      ? { status: w.payment_issue.status, renewsAt: w.payment_issue.renews_at ?? null }
      : null,
  };
}

/** Null when the server cannot be reached or has no promos (self-hosted answers 503). */
export async function fetchPromoState(): Promise<PromoState | null> {
  try {
    const res = await serverFetch("/v1/promos");
    if (!res.ok) return null;
    return fromWire((await res.json()) as PromoStateWire);
  } catch {
    return null;
  }
}

export async function recordPromoEvent(
  promo: PromoId,
  event: PromoEvent,
  source: PromoSource,
  occurrence?: number,
): Promise<void> {
  try {
    await serverFetch("/v1/promos/events", {
      method: "POST",
      body: JSON.stringify({ promo, event, source, ...(occurrence !== undefined && { occurrence }) }),
    });
  } catch {
    // telemetry only
  }
}

export type ActivateResult = "ok" | "email_unverified" | "unavailable" | "error";

export async function activateTrial(plan: "pro" | "teams", source: PromoSource): Promise<ActivateResult> {
  try {
    const res = await serverFetch("/v1/billing/trial", {
      method: "POST",
      body: JSON.stringify({ plan, source }),
    });
    if (res.ok) {
      // The trial is already active server-side; a failed refresh must not turn that into an error.
      try {
        await refreshAccessToken();
        await useSubscriptionStore.getState().load();
        await usePromoStore.getState().load();
      } catch {
        // best-effort resync
      }
      return "ok";
    }
    const body = await res.json().catch(() => null);
    if (checkoutRequiresEmailVerification(res.status, body)) {
      window.dispatchEvent(new CustomEvent(EMAIL_VERIFICATION_REQUIRED_EVENT));
      return "email_unverified";
    }
    if (res.status === 409) return "unavailable";
    return "error";
  } catch {
    return "error";
  }
}

export async function startTrialOrCheckout(
  plan: "pro" | "teams",
  source: PromoSource,
  context?: PaywallContext,
): Promise<boolean> {
  if (getServerCapability("billingEnabled") && CAN_OPEN_CHECKOUT) {
    const s = usePromoStore.getState().state;
    if (s && (plan === "pro" ? s.proTrialAvailable : s.teamsTrialAvailable)) {
      usePromoStore.getState().open(plan === "pro" ? "pro_redeem" : "teams_promo", source, context);
      return true;
    }
  }
  return openBillingCheckout(plan);
}
