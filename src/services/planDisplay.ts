import { useShallow } from "zustand/shallow";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { CAN_OPEN_CHECKOUT } from "@/services/distribution";
import { useServerBillingEnabled } from "@/services/serverCapabilities";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useTeamStore } from "@/stores/teamStore";
import type { SeatTeam, Tier, TierFlags } from "@/stores/subscriptionTier";

export interface PlanDisplay {
  plan: Tier;
  premium: boolean;
  seat: boolean;
  label: string;
  badge: string;
  icon: string;
  via: string | null;
  line: string;
  viaTooltip: string | null;
  viaLine: string | null;
  ownLine: string | null;
  trial: boolean;
  trialDaysLeft: number | null;
  ownBilled: boolean;
  showManageBilling: boolean;
  showAllPlans: boolean;
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

export function seatTeamName(teams: readonly { id: string; name: string }[], seatTeam: SeatTeam | null): string | null {
  return seatTeam ? (teams.find((t) => t.id === seatTeam.id)?.name ?? null) : null;
}

export interface PlanDisplayContext {
  teamName?: string | null;
  billingEnabled?: boolean;
  now?: Date;
}

export function planDisplay(flags: PlanDisplayInput, context: PlanDisplayContext = {}): PlanDisplay {
  const { teamName = null, billingEnabled = true, now = new Date() } = context;
  const { tier, billingTier, seatTeam } = flags;
  const ownTrial = flags.isTrialActive;
  const trial = seatTeam ? seatTeam.trial : ownTrial;
  const name = i18n.t(`settings.account.plan.name.${tier}`);
  const label = trial ? i18n.t("settings.account.plan.trialName", { plan: name }) : name;
  const via = seatTeam ? teamName : null;
  const trialDaysLeft =
    ownTrial && !seatTeam && flags.trialEndsAt
      ? Math.max(0, Math.ceil((flags.trialEndsAt.getTime() - now.getTime()) / DAY_MS))
      : null;
  const ownPaid = billingTier !== "free" && !ownTrial;
  const ownBilled = ownPaid && billingEnabled;
  const upgradeTo = CAN_OPEN_CHECKOUT && !seatTeam ? NEXT_PLAN[tier] : null;
  const premium = tier !== "free";
  const trialOffer = upgradeTo === "pro" && flags.trialKnown && !flags.trialUsed;
  const ownLabel = trialDaysLeft !== null
    ? i18n.t("settings.account.plan.trialLeft", { plan: label, daysLeft: trialDaysLeft })
    : label;
  return {
    plan: tier,
    premium,
    seat: seatTeam !== null,
    label,
    badge: premium ? (seatTeam ? label : ownLabel)
      : trialOffer ? i18n.t("layout.titleBar.plan.upgradeTrial")
      : upgradeTo === "pro" ? i18n.t("layout.titleBar.plan.upgrade")
      : label,
    icon: premium ? "lucide:crown" : upgradeTo ? "lucide:circle-fading-arrow-up" : "lucide:circle-user",
    via,
    line: via ? i18n.t("settings.account.plan.viaSeat", { plan: label, team: via }) : ownLabel,
    viaTooltip: via ? i18n.t("settings.account.plan.viaTooltip", { team: via }) : null,
    viaLine: via ? i18n.t("settings.account.plan.throughSeat", { team: via }) : null,
    ownLine:
      seatTeam && ownPaid
        ? i18n.t("settings.account.plan.ownLine", { plan: i18n.t(`settings.account.plan.name.${billingTier}`) })
        : null,
    trial,
    trialDaysLeft,
    ownBilled,
    showManageBilling: ownBilled && CAN_OPEN_CHECKOUT,
    showAllPlans: billingEnabled && CAN_OPEN_CHECKOUT && !seatTeam,
    showUpgrade: upgradeTo === "pro",
    upgradeTo,
    trialOffer,
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
  const teamName = useTeamStore((s) => seatTeamName(s.teams, flags.seatTeam));
  const billingEnabled = useServerBillingEnabled();
  return planDisplay(flags, { teamName, billingEnabled });
}
