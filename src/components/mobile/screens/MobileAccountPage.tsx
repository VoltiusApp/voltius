import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import MobilePanelHeader from "../panels/MobilePanelHeader";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useUIStore } from "@/stores/uiStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { usePlanDisplay } from "@/services/planDisplay";
import { useSyncProviders } from "@/hooks/useSyncProviders";
import { SYNC_NEARBY_COLOR, SYNC_NEARBY_ICON, SYNC_PAUSED_ICON, syncStatusIcon, syncStatusColor } from "@/services/syncStatus";
import { isNearbyOnly } from "@/services/syncProviders";
import { effectiveSyncLabel } from "@/services/syncStatusText";
import { getCurrentUserEmail, logout } from "@/services/account";
import { openBillingCheckout } from "@/services/billingCheckout";
import { TEAMS_TRIAL_DAYS } from "@/services/billingTrial";
import { openPortal } from "@/utils/billing";
import { AvailableWithPlan } from "@/components/shared/AvailableWithPlan";
import { useSeatReadout } from "@/hooks/useSeatReadout";
import { seatsUsedText } from "@/services/seatMath";
import { formatOptionalDate, SHORT_DATE } from "@/utils/localeFormat";
import { DeleteAccountModal } from "@/components/shared/DeleteAccountModal";

export default function MobileAccountPage() {
  const { t } = useTranslation();
  const plan = usePlanDisplay();
  const pop = useMobileNavStore((s) => s.pop);
  const openSheet = useMobileNavStore((s) => s.openSheet);
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);
  const accountMode = useSubscriptionStore((s) => s.accountMode);
  const ownsTeamsPlan = useSubscriptionStore((s) => s.ownsTeamsPlan);
  const seatsText = seatsUsedText(t, useSeatReadout(), "mobile.account.seatsUsed");
  const subscriptionStatus = useSubscriptionStore((s) => s.subscriptionStatus);
  const subscriptionCancelled = useSubscriptionStore((s) => s.subscriptionCancelled);
  const renewsAt = useSubscriptionStore((s) => s.renewsAt);
  const endsAt = useSubscriptionStore((s) => s.endsAt);
  const sync = useSyncProviders().effective;
  const nearbyOnly = isNearbyOnly(sync);
  const [email, setEmail] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  useEffect(() => { void getCurrentUserEmail().then(setEmail); }, []);

  const signedIn = accountMode === "server";
  const renewalDate = formatOptionalDate(renewsAt, SHORT_DATE);
  const cancellationDate = formatOptionalDate(endsAt ?? renewsAt, SHORT_DATE);

  const checkout = async (plan: "pro" | "teams") => {
    if (checkoutBusy) return;
    setCheckoutBusy(true);
    try { await openBillingCheckout(plan); } finally { setCheckoutBusy(false); }
  };

  const Row = ({ icon, label, value, valueColor, sub, onTap }: { icon: string; label: string; value: string; valueColor?: string; sub?: string | null; onTap?: () => void }) => {
    const Tag = onTap ? "button" : "div";
    return (
      <Tag
        {...(onTap && { "data-account-sync": "", onClick: onTap })}
        className="w-full flex items-center gap-3 px-4 py-3.5 border-b text-left"
        style={{ borderColor: "var(--t-border)" }}
      >
        <Icon icon={icon} width={18} className="text-(--t-text-dim) shrink-0" />
        <span className="flex-1 text-sm text-(--t-text-primary)">{label}</span>
        <span className="flex flex-col items-end min-w-0 max-w-[55%]">
          <span className="text-sm truncate max-w-full" style={{ color: valueColor ?? "var(--t-text-dim)" }}>{value}</span>
          {sub && <span data-account-plan-via className="text-xs truncate max-w-full text-(--t-text-dim)" title={sub}>{sub}</span>}
        </span>
        {onTap && <Icon icon="lucide:chevron-right" width={16} className="text-(--t-text-dim) shrink-0" />}
      </Tag>
    );
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <MobilePanelHeader title={t("mobile.account.title")} />
      <div className="flex-1 overflow-y-auto">
        <Row icon="lucide:mail" label={t("mobile.account.email")} value={email ?? (signedIn ? "—" : t("mobile.account.notSignedIn"))} />
        <Row icon="lucide:badge-check" label={t("mobile.account.plan")} value={plan.via ? plan.label : plan.line} sub={plan.viaLine} valueColor={plan.premium ? "#f59e0b" : undefined} />
        <Row
          icon={nearbyOnly ? SYNC_NEARBY_ICON : sync.paused ? SYNC_PAUSED_ICON : syncStatusIcon(sync.status)}
          label={t("layout.sync.title")}
          value={effectiveSyncLabel(t, sync)}
          valueColor={nearbyOnly ? SYNC_NEARBY_COLOR : sync.configured ? syncStatusColor(sync.status) : undefined}
          onTap={() => openSheet({ kind: "sync" })}
        />

        {signedIn && (
          <div className="p-4 flex flex-col gap-3">
            {(plan.ownLine || plan.ownBilled) && (
              <div data-account-own-plan-card className="rounded-xl px-3 py-2.5 flex flex-col gap-1 bg-(--t-bg-elevated) border border-(--t-border)">
                {plan.ownLine && <span data-account-own-plan className="text-sm text-(--t-text-primary)">{plan.ownLine}</span>}
                {plan.ownBilled && (
                  <span className="text-xs text-(--t-text-muted)">
                    {subscriptionCancelled
                      ? t("mobile.account.cancelsOn", { date: cancellationDate ?? t("mobile.account.periodEnd") })
                      : subscriptionStatus === "active" && renewalDate
                        ? t("mobile.account.renewsOn", { date: renewalDate })
                        : t("mobile.account.subscriptionActive")}
                  </span>
                )}
              </div>
            )}

            {ownsTeamsPlan && seatsText && (
              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-(--t-text-secondary)">{t("mobile.account.seats")}</span>
                <span className="text-(--t-text-primary)" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {seatsText}
                </span>
              </div>
            )}

            {!plan.premium && !plan.showUpgrade && <AvailableWithPlan plan="Pro" />}

            {plan.showUpgrade && (
              <button
                data-account-upgrade-pro
                disabled={checkoutBusy}
                onClick={() => void checkout("pro")}
                className="w-full h-11 rounded-xl text-sm font-semibold disabled:opacity-60"
                style={{ background: "var(--t-accent)", color: "#fff" }}
              >
                {t("mobile.account.upgradeToPro")}
              </button>
            )}

            {plan.upgradeTo === "teams" && (
              <>
                <button
                  data-account-upgrade-teams
                  disabled={checkoutBusy}
                  onClick={() => void checkout("teams")}
                  className="w-full h-11 rounded-xl text-sm font-semibold text-(--t-text-primary) disabled:opacity-60"
                  style={{ border: "1px solid var(--t-border)" }}
                >
                  {t("mobile.account.upgradeToTeams", { days: TEAMS_TRIAL_DAYS })}
                </button>
                <p className="-mt-1 text-center text-xs text-(--t-text-dim)">{t("mobile.account.teamsTrialNote")}</p>
              </>
            )}

            {(plan.showManageBilling || plan.showAllPlans) && (
              <button
                data-account-manage-billing
                onClick={() => void openPortal()}
                className="w-full h-11 rounded-xl text-sm font-medium text-(--t-text-primary) flex items-center justify-center gap-2"
                style={{ border: "1px solid var(--t-border)" }}
              >
                <Icon icon="lucide:external-link" width={16} />
                {plan.showManageBilling ? t("mobile.account.manageBilling") : t("mobile.account.viewAllPlans")}
              </button>
            )}
          </div>
        )}

        <div className="p-4 pt-0">
          {!signedIn ? (
            <button
              data-account-signin
              onClick={() => { pop(); openCloudAuth("signin"); }}
              className="w-full h-11 rounded-xl text-sm font-semibold"
              style={{ background: "var(--t-accent)", color: "#fff" }}
            >
              {t("mobile.account.signInToSync")}
            </button>
          ) : confirming ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-(--t-text-dim)">{t("mobile.account.signOutConfirm")}</p>
              <button
                data-account-signout-confirm
                onClick={() => { void logout(); pop(); }}
                className="w-full h-11 rounded-xl text-sm font-semibold"
                style={{ background: "var(--t-danger, #e5484d)", color: "#fff" }}
              >
                {t("mobile.account.signOut")}
              </button>
              <button onClick={() => setConfirming(false)} className="w-full h-11 rounded-xl text-sm font-medium text-(--t-text-primary)" style={{ border: "1px solid var(--t-border)" }}>
                {t("common.action.cancel")}
              </button>
            </div>
          ) : (
            <button
              data-account-signout
              onClick={() => setConfirming(true)}
              className="w-full h-11 rounded-xl text-sm font-semibold text-(--t-text-primary) flex items-center justify-center gap-2"
              style={{ border: "1px solid var(--t-border)" }}
            >
              <Icon icon="lucide:log-out" width={16} />
              {t("mobile.account.signOut")}
            </button>
          )}
          {signedIn && !confirming && (
            <button
              data-account-delete
              onClick={() => setDeletingAccount(true)}
              className="mt-3 w-full h-11 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
              style={{ color: "var(--t-danger, #e5484d)" }}
            >
              <Icon icon="lucide:user-x" width={16} />
              {t("shared.deleteAccount.action")}
            </button>
          )}
        </div>
        {deletingAccount && (
          <DeleteAccountModal onCancel={() => setDeletingAccount(false)} onDeleted={() => { setDeletingAccount(false); pop(); }} />
        )}
      </div>
    </div>
  );
}
