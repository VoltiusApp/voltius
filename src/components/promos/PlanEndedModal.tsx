import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { openBillingCheckout } from "@/services/billingCheckout";
import { PLAN_PRICES } from "@/services/billingTrial";
import { startTrialOrCheckout, type PromoState } from "@/services/promos";
import { openPortal } from "@/utils/billing";
import { usePromoStore } from "@/stores/promoStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { PromoBody, PromoFooter, PromoSurface, PromoTitle } from "./PromoSurface";
import { recordPromoClick, type PromoModalProps } from "./useTrialActivation";

type EndedKind = NonNullable<PromoState["planEnded"]>["kind"];
type Variant =
  | { kind: "payment" }
  | { kind: "plan"; ended: EndedKind }
  | { kind: "member"; team: string };

/**
 * Which end notice `occurrence` names, in the picker's precedence order (payment issue,
 * plan ended, team ended). Without an occurrence, the first one present.
 */
export function planEndVariant(state: PromoState | null, occurrence?: number): Variant | null {
  if (!state) return null;
  const present: [number, Variant][] = [];
  if (state.paymentIssue) present.push([state.paymentIssue.renewsAt ?? 0, { kind: "payment" }]);
  if (state.planEnded) present.push([state.planEnded.at, { kind: "plan", ended: state.planEnded.kind }]);
  if (state.teamEnded) present.push([state.teamEnded.at, { kind: "member", team: state.teamEnded.teamName }]);
  const hit = occurrence === undefined ? present[0] : present.find(([at]) => at === occurrence);
  return hit?.[1] ?? null;
}

const PLAN_NAME = { pro: "Pro", teams: "Teams", business: "Business" } as const;
const TITLE_KEY: Record<EndedKind, string> = {
  pro_trial: "shared.promos.ended.titleProTrial",
  teams_trial: "shared.promos.ended.titleTeamsTrial",
  subscription: "shared.promos.ended.titleSubscription",
};
const PAUSED_PRO = ["pausedSync", "pausedSessions", "pausedVaults"];
const STILL_FREE = ["freeCore", "freeSync", "freeExport"];

export function PlanEndedModal({ source, occurrence, onClose }: PromoModalProps & { occurrence?: number }) {
  const { t } = useTranslation();
  const state = usePromoStore((s) => s.state);
  const billingTier = useSubscriptionStore((s) => s.billingTier);
  const variant = planEndVariant(state, occurrence);
  const dismiss = () => onClose("dismissed");

  // The end notice can vanish when the state reloads; nothing to show means nothing to keep open.
  // "activated" so no dismissal is recorded for a notice nobody saw.
  useEffect(() => {
    if (!variant) onClose("activated");
  }, [variant, onClose]);

  if (!variant) return null;

  if (variant.kind === "member") {
    return (
      <Notice
        onClose={dismiss}
        title={t("shared.promos.ended.titleMember", { team: variant.team })}
        body={t("shared.promos.ended.bodyMember")}
        footer={<PromoFooter cta={t("shared.promos.ended.gotIt")} onCta={dismiss} />}
      />
    );
  }

  if (variant.kind === "payment") {
    const plan = PLAN_NAME[billingTier === "teams" || billingTier === "business" ? billingTier : "pro"];
    return (
      <Notice
        onClose={dismiss}
        icon={<Icon icon="lucide:credit-card" width={22} className="mb-4 text-(--t-status-warning)" aria-hidden />}
        title={t("shared.promos.ended.payment.title")}
        body={t("shared.promos.ended.payment.body", { plan })}
        footer={
          <PromoFooter
            cta={t("shared.promos.ended.payment.cta")}
            onCta={() => {
              recordPromoClick();
              void openPortal();
              onClose("activated");
            }}
            secondary={t("shared.promos.ended.payment.later")}
            onSecondary={dismiss}
          />
        }
      />
    );
  }

  // A lapsed subscription does not say which plan it was; Pro is the one most people keep.
  const plan = variant.ended === "teams_trial" ? "teams" : "pro";
  const prices = PLAN_PRICES[plan];
  const offerTeams = plan !== "teams" && state?.teamsTrialAvailable === true;
  const paused = plan === "teams" ? [...PAUSED_PRO, "pausedTeam"] : PAUSED_PRO;

  return (
    <PromoSurface onClose={dismiss}>
      <div className="px-6 sm:px-9 pt-7 flex flex-col">
        <SyncStopped />
        <PromoTitle>{t(TITLE_KEY[variant.ended])}</PromoTitle>
        <PromoBody>{t("shared.promos.ended.body")}</PromoBody>
        <HostsRecap />
        <div className="mt-4.5 grid grid-cols-1 sm:grid-cols-2 gap-4.5">
          <ItemList title={t("shared.promos.ended.paused")} titleClass="text-(--t-status-warning)" items={paused} />
          <ItemList title={t("shared.promos.ended.free")} titleClass="text-(--t-status-connected)" items={STILL_FREE} />
        </div>
      </div>
      <div className="px-6 sm:px-9 pt-5.5 pb-5">
        <PromoFooter
          cta={plan === "teams"
            ? t("shared.promos.ended.ctaTeams", { annual: prices.annual })
            : t("shared.promos.ended.cta", { plan: PLAN_NAME[plan], annual: prices.annual })}
          onCta={() => {
            recordPromoClick();
            void openBillingCheckout(plan);
            onClose("activated");
          }}
          note={t(plan === "teams" ? "shared.promos.ended.ctaNoteTeams" : "shared.promos.ended.ctaNote", { monthly: prices.monthly })}
          secondary={t("shared.promos.ended.continueFree")}
          onSecondary={dismiss}
          link={offerTeams ? {
            label: t("shared.promos.ended.tryTeams"),
            onClick: () => {
              dismiss();
              void startTrialOrCheckout("teams", source);
            },
          } : undefined}
        />
      </div>
    </PromoSurface>
  );
}

/** Title, body and actions only: the notices that have nothing to recap. */
function Notice({ onClose, icon, title, body, footer }: {
  onClose: () => void;
  icon?: ReactNode;
  title: string;
  body: string;
  footer: ReactNode;
}) {
  return (
    <PromoSurface onClose={onClose}>
      <div className="px-6 sm:px-9 pt-7 pb-5 flex flex-col">
        {icon}
        <PromoTitle>{title}</PromoTitle>
        <PromoBody>{body}</PromoBody>
        <div className="mt-6">{footer}</div>
      </div>
    </PromoSurface>
  );
}

function ItemList({ title, titleClass, items }: { title: string; titleClass: string; items: string[] }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className={`text-xs font-semibold mb-2 ${titleClass}`}>{title}</div>
      <ul className="m-0 p-0 list-none flex flex-col gap-1.5 text-[13px] text-(--t-text-primary)">
        {items.map((k) => <li key={k}>{t(`shared.promos.ended.${k}`)}</li>)}
      </ul>
    </div>
  );
}

/** Only a figure the app actually holds: the hosts this account keeps. */
function HostsRecap() {
  const { t } = useTranslation();
  const hosts = useConnectionStore((s) => s.connections.length);
  if (hosts === 0) return null;
  return (
    <div className="promo-rise mt-5 py-4 flex items-baseline gap-3 border-y border-(--t-border)">
      <span className="text-[28px] leading-none font-bold tabular-nums text-(--t-text-bright)">{hosts}</span>
      <span className="text-xs text-(--t-text-muted)">{t("shared.promos.ended.recapHosts")}</span>
    </div>
  );
}

/** Sync leaving the laptop and pausing halfway to the phone. */
function SyncStopped() {
  const tile = "w-10 h-10 rounded-[12px] bg-(--t-bg-elevated) flex items-center justify-center text-(--t-text-secondary)";
  return (
    <div aria-hidden="true" className="flex items-center mb-5.5">
      <span className={tile}><Icon icon="lucide:monitor" width={20} /></span>
      <span className="relative w-[120px] h-0.5 mx-1.5 bg-(--t-border)">
        <span className="promo-dot promo-dot-stop" />
        <span className="promo-pause absolute left-[calc(50%-11px)] -top-[11px] w-[22px] h-[22px] rounded-full bg-(--t-bg-modal) ring-1 ring-(--t-status-warning) flex items-center justify-center text-(--t-status-warning)">
          <Icon icon="lucide:pause" width={10} />
        </span>
      </span>
      <span className={tile}><Icon icon="lucide:smartphone" width={18} /></span>
    </div>
  );
}
