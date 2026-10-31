import { useShallow } from "zustand/shallow";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { CAN_OPEN_CHECKOUT } from "@/services/distribution";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import type { Tier, TierFlags } from "@/stores/subscriptionTier";

export interface PlanDisplay {
  plan: Tier;
  premium: boolean;
  label: string;
  via: string | null;
  line: string;
  viaTooltip: string | null;
  ownLine: string | null;
  trial: boolean;
  trialDaysLeft: number | null;
  ownPaid: boolean;
  showManageBilling: boolean;
  showUpgrade: boolean;
  upgradeTo: Tier | null;
  trialOffer: boolean;
  showTrialEnded: boolean;
}

export type PlanDisplayInput = Pick<
  TierFlags,
  "tier" | "billingTier" | "seatTeam" | "isTrialActive" | "trialEndsAt" | "trialKnown" | "trialUsed"
> & {
  subscriptionStatus?: string | null;
};

const NEXT_PLAN: Record<Tier, Tier | null> = { free: "pro", pro: "teams", teams: "business", business: null };
const DAY_MS = 86_400_000;

export function planDisplay(flags: PlanDisplayInput, now: Date = new Date()): PlanDisplay {
  const { tier, billingTier, seatTeam } = flags;
  const ownTrial = flags.isTrialActive;
  const trial = seatTeam ? seatTeam.trial : ownTrial;
  const name = i18n.t(`settings.account.plan.name.${tier}`);
  const label = trial ? i18n.t("settings.account.plan.trialName", { plan: name }) : name;
  const via = seatTeam?.name ?? null;
  const trialDaysLeft =
    ownTrial && !seatTeam && flags.trialEndsAt
      ? Math.max(0, Math.ceil((flags.trialEndsAt.getTime() - now.getTime()) / DAY_MS))
      : null;
  const ownPaid = billingTier !== "free" && !ownTrial;
  const upgradeTo = CAN_OPEN_CHECKOUT && !seatTeam ? NEXT_PLAN[tier] : null;
  return {
    plan: tier,
    premium: tier !== "free",
    label,
    via,
    line: via
      ? i18n.t("settings.account.plan.viaSeat", { plan: label, team: via })
      : trialDaysLeft !== null
        ? i18n.t("settings.account.plan.trialLeft", { plan: label, daysLeft: trialDaysLeft })
        : label,
    viaTooltip: via ? i18n.t("settings.account.plan.viaTooltip", { team: via }) : null,
    ownLine:
      seatTeam && ownPaid
        ? i18n.t("settings.account.plan.ownLine", { plan: i18n.t(`settings.account.plan.name.${billingTier}`) })
        : null,
    trial,
    trialDaysLeft,
    ownPaid,
    showManageBilling: ownPaid && CAN_OPEN_CHECKOUT,
    showUpgrade: upgradeTo === "pro",
    upgradeTo,
    trialOffer: upgradeTo === "pro" && flags.trialKnown && !flags.trialUsed,
    showTrialEnded: tier === "free" && !seatTeam && !ownTrial && flags.trialUsed,
  };
}

export function usePlanDisplay(): PlanDisplay {
  useTranslation();
  const flags = useSubscriptionStore(
    useShallow((s) => ({
      tier: s.tier,
      billingTier: s.billingTier,
      seatTeam: s.seatTeam,
      isTrialActive: s.isTrialActive,
      trialEndsAt: s.trialEndsAt,
      trialKnown: s.trialKnown,
      trialUsed: s.trialUsed,
      subscriptionStatus: s.subscriptionStatus,
    })),
  );
  return planDisplay(flags);
}
