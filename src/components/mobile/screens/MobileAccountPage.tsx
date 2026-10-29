import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import MobilePanelHeader from "../panels/MobilePanelHeader";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useUIStore } from "@/stores/uiStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useSyncProviders } from "@/hooks/useSyncProviders";
import { SYNC_NEARBY_COLOR, SYNC_NEARBY_ICON, SYNC_PAUSED_ICON, syncStatusIcon, syncStatusColor } from "@/services/syncStatus";
import { isNearbyOnly } from "@/services/syncProviders";
import { effectiveSyncLabel } from "@/services/syncStatusText";
import { getCurrentUserEmail, logout } from "@/services/account";
import { openBillingCheckout } from "@/services/billingCheckout";
import { TEAMS_TRIAL_DAYS } from "@/services/billingTrial";
import { openPortal } from "@/utils/billing";
import { CAN_OPEN_CHECKOUT } from "@/services/distribution";
import { AvailableWithPlan } from "@/components/shared/AvailableWithPlan";
import { useServerBillingEnabled } from "@/services/serverCapabilities";
import { useSeatReadout } from "@/hooks/useSeatReadout";
import { seatsUsedText } from "@/services/seatMath";
import { formatOptionalDate, SHORT_DATE } from "@/utils/localeFormat";
import { DeleteAccountModal } from "@/components/shared/DeleteAccountModal";

export default function MobileAccountPage() {
  const { t } = useTranslation();
  const TIER_LABEL: Record<string, string> = {
    free: t("mobile.account.tier.free"),
    pro: t("mobile.account.tier.pro"),
    teams: t("mobile.account.tier.teams"),
    business: t("mobile.account.tier.business"),
  };
  const pop = useMobileNavStore((s) => s.pop);
  const openSheet = useMobileNavStore((s) => s.openSheet);
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);
  const tier = useSubscriptionStore((s) => s.tier);
  const accountMode = useSubscriptionStore((s) => s.accountMode);
  const trialEndsAt = useSubscriptionStore((s) => s.trialEndsAt);
  const isTrialActive = useSubscriptionStore((s) => s.isTrialActive);
  const isPro = useSubscriptionStore((s) => s.isPro);
  const isTeams = useSubscriptionStore((s) => s.isTeams);
  const billingEnabled = useServerBillingEnabled();
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
  const isPaidPro = isPro && !isTrialActive && billingEnabled;
  const daysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000)) : 0;
  const planValue = isTrialActive ? t("mobile.account.proTrial", { days: daysLeft }) : (TIER_LABEL[tier] ?? tier);
  const renewalDate = formatOptionalDate(renewsAt, SHORT_DATE);
  const cancellationDate = formatOptionalDate(endsAt ?? renewsAt, SHORT_DATE);

  const checkout = async (plan: "pro" | "teams") => {
    if (checkoutBusy) return;
    setCheckoutBusy(true);
    try { await openBillingCheckout(plan); } finally { setCheckoutBusy(false); }
  };

  const Row = ({ icon, label, value, valueColor, onTap }: { icon: string; label: string; value: string; valueColor?: string; onTap?: () => void }) => {
    const Tag = onTap ? "button" : "div";
    return (
      <Tag
        {...(onTap && { "data-account-sync": "", onClick: onTap })}
        className="w-full flex items-center gap-3 px-4 py-3.5 border-b text-left"
        style={{ borderColor: "var(--t-border)" }}
      >
        <Icon icon={icon} width={18} className="text-(--t-text-dim) shrink-0" />
        <span className="flex-1 text-sm text-(--t-text-primary)">{label}</span>
        <span className="text-sm truncate max-w-[55%]" style={{ color: valueColor ?? "var(--t-text-dim)" }}>{value}</span>
        {onTap && <Icon icon="lucide:chevron-right" width={16} className="text-(--t-text-dim) shrink-0" />}
      </Tag>
    );
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <MobilePanelHeader title={t("mobile.account.title")} />
      <div className="flex-1 overflow-y-auto">
        <Row icon="lucide:mail" label={t("mobile.account.email")} value={email ?? (signedIn ? "—" : t("mobile.account.notSignedIn"))} />
        <Row icon="lucide:badge-check" label={t("mobile.account.plan")} value={planValue} valueColor={isPro ? "#f59e0b" : undefined} />
        <Row
          icon={nearbyOnly ? SYNC_NEARBY_ICON : sync.paused ? SYNC_PAUSED_ICON : syncStatusIcon(sync.status)}
          label={t("layout.sync.title")}
          value={effectiveSyncLabel(t, sync)}
          valueColor={nearbyOnly ? SYNC_NEARBY_COLOR : sync.configured ? syncStatusColor(sync.status) : undefined}
          onTap={() => openSheet({ kind: "sync" })}
        />

        {signedIn && (
          <div className="p-4 flex flex-col gap-3">
            {isPaidPro && (
              <div className="rounded-xl px-3 py-2.5 text-xs text-(--t-text-muted)" style={{ background: "var(--t-bg-input)" }}>
                {subscriptionCancelled ? (
                  <span>{t("mobile.account.cancelsOn", { date: cancellationDate ?? t("mobile.account.periodEnd") })}</span>
                ) : subscriptionStatus === "active" && renewalDate ? (
                  <span>{t("mobile.account.renewsOn", { date: renewalDate })}</span>
                ) : (
                  <span>{t("mobile.account.subscriptionActive")}</span>
                )}
              </div>
            )}

            {isTeams && seatsText && (
              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-(--t-text-secondary)">{t("mobile.account.seats")}</span>
                <span className="text-(--t-text-primary)" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {seatsText}
                </span>
              </div>
            )}

            {!isPro && !CAN_OPEN_CHECKOUT && <AvailableWithPlan plan="Pro" />}

            {!isPro && CAN_OPEN_CHECKOUT && (
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

            {isPro && !isTeams && CAN_OPEN_CHECKOUT && (
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

            {billingEnabled && CAN_OPEN_CHECKOUT && (
              <button
                data-account-manage-billing
                onClick={() => void openPortal()}
                className="w-full h-11 rounded-xl text-sm font-medium text-(--t-text-primary) flex items-center justify-center gap-2"
                style={{ border: "1px solid var(--t-border)" }}
              >
                <Icon icon="lucide:external-link" width={16} />
                {isPro ? t("mobile.account.manageBilling") : t("mobile.account.viewAllPlans")}
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
