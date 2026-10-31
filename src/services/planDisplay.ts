import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { CAN_OPEN_CHECKOUT } from "@/services/distribution";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import type { Tier, TierFlags } from "@/stores/subscriptionTier";

export interface PlanDisplay {
  plan: Tier;
  label: string;
  via: string | null;
  line: string;
  viaTooltip: string | null;
  trial: boolean;
  showManageBilling: boolean;
  showUpgrade: boolean;
  showTrialEnded: boolean;
}

export type PlanDisplayInput = TierFlags & { subscriptionStatus?: string | null };

export function planDisplay(flags: PlanDisplayInput): PlanDisplay {
  const { tier, billingTier, seatTeam } = flags;
  const ownTrial = flags.isTrialActive && !seatTeam;
  const trial = seatTeam ? seatTeam.trial : ownTrial;
  const name = i18n.t(`settings.account.plan.name.${tier}`);
  const label = trial ? i18n.t("settings.account.plan.trialName", { plan: name }) : name;
  const via = seatTeam?.name ?? null;
  return {
    plan: tier,
    label,
    via,
    line: via ? i18n.t("settings.account.plan.viaSeat", { plan: label, team: via }) : label,
    viaTooltip: via ? i18n.t("settings.account.plan.viaTooltip", { team: via }) : null,
    trial,
    showManageBilling: billingTier !== "free" && !ownTrial,
    showUpgrade: tier === "free" && CAN_OPEN_CHECKOUT,
    showTrialEnded: tier === "free" && !seatTeam && !flags.isTrialActive && flags.trialUsed,
  };
}

export function usePlanDisplay(): PlanDisplay {
  useTranslation();
  const flags = useSubscriptionStore();
  return planDisplay(flags);
}
