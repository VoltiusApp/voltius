import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import MobilePanelHeader from "../panels/MobilePanelHeader";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useUIStore } from "@/stores/uiStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useEffectiveSyncStatus } from "@/hooks/useEffectiveSyncStatus";
import { syncStatusIcon, syncStatusColor } from "@/services/syncStatus";
import { getCurrentUserEmail, logout } from "@/services/account";
import { openBillingCheckout } from "@/services/billingCheckout";
import { openPortal } from "@/utils/billing";

const TIER_LABEL: Record<string, string> = { free: "Free", pro: "Pro", teams: "Teams", business: "Business" };

function formatPlanDate(date: Date | null): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export default function MobileAccountPage() {
  const pop = useMobileNavStore((s) => s.pop);
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);
  const tier = useSubscriptionStore((s) => s.tier);
  const accountMode = useSubscriptionStore((s) => s.accountMode);
  const trialEndsAt = useSubscriptionStore((s) => s.trialEndsAt);
  const isTrialActive = useSubscriptionStore((s) => s.isTrialActive);
  const isPro = useSubscriptionStore((s) => s.isPro);
  const isTeams = useSubscriptionStore((s) => s.isTeams);
  const usedSeats = useSubscriptionStore((s) => s.usedSeats);
  const totalSeats = useSubscriptionStore((s) => s.totalSeats);
  const subscriptionStatus = useSubscriptionStore((s) => s.subscriptionStatus);
  const subscriptionCancelled = useSubscriptionStore((s) => s.subscriptionCancelled);
  const renewsAt = useSubscriptionStore((s) => s.renewsAt);
  const endsAt = useSubscriptionStore((s) => s.endsAt);
  const sync = useEffectiveSyncStatus();
  const [email, setEmail] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  useEffect(() => { void getCurrentUserEmail().then(setEmail); }, []);

  const signedIn = accountMode === "server";
  const isPaidPro = isPro && !isTrialActive;
  const daysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000)) : 0;
  const planValue = isTrialActive ? `Pro Trial — ${daysLeft}d left` : (TIER_LABEL[tier] ?? tier);
  const renewalDate = formatPlanDate(renewsAt);
  const cancellationDate = formatPlanDate(endsAt ?? renewsAt);

  const checkout = async (plan: "pro" | "teams") => {
    if (checkoutBusy) return;
    setCheckoutBusy(true);
    try { await openBillingCheckout(plan); } finally { setCheckoutBusy(false); }
  };

  const Row = ({ icon, label, value, valueColor }: { icon: string; label: string; value: string; valueColor?: string }) => (
    <div className="flex items-center gap-3 px-4 py-3.5 border-b" style={{ borderColor: "var(--t-border)" }}>
      <Icon icon={icon} width={18} className="text-(--t-text-dim) shrink-0" />
      <span className="flex-1 text-sm text-(--t-text-primary)">{label}</span>
      <span className="text-sm truncate max-w-[55%]" style={{ color: valueColor ?? "var(--t-text-dim)" }}>{value}</span>
    </div>
  );

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <MobilePanelHeader title="Account" />
      <div className="flex-1 overflow-y-auto">
        <Row icon="lucide:mail" label="Email" value={email ?? (signedIn ? "—" : "Not signed in")} />
        <Row icon="lucide:badge-check" label="Plan" value={planValue} valueColor={isPro ? "#f59e0b" : undefined} />
        <Row
          icon={syncStatusIcon(sync.status)}
          label="Cloud sync"
          value={sync.configured ? sync.status : "Off"}
          valueColor={sync.configured ? syncStatusColor(sync.status) : undefined}
        />

        {signedIn && (
          <div className="p-4 flex flex-col gap-3">
            {isPaidPro && (
              <div className="rounded-xl px-3 py-2.5 text-xs text-(--t-text-muted)" style={{ background: "var(--t-bg-input)" }}>
                {subscriptionCancelled ? (
                  <span>Cancels on {cancellationDate ?? "the period end"}. You keep access until then.</span>
                ) : subscriptionStatus === "active" && renewalDate ? (
                  <span>Renews on {renewalDate}.</span>
                ) : (
                  <span>Your subscription is active.</span>
                )}
              </div>
            )}

            {isTeams && totalSeats != null && (
              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-(--t-text-secondary)">Seats</span>
                <span className="text-(--t-text-primary)" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {usedSeats ?? "…"} / {totalSeats} used
                </span>
              </div>
            )}

            {!isPro && (
              <button
                data-account-upgrade-pro
                disabled={checkoutBusy}
                onClick={() => void checkout("pro")}
                className="w-full h-11 rounded-xl text-sm font-semibold disabled:opacity-60"
                style={{ background: "var(--t-accent)", color: "#fff" }}
              >
                Upgrade to Pro
              </button>
            )}

            {isPro && !isTeams && (
              <button
                data-account-upgrade-teams
                disabled={checkoutBusy}
                onClick={() => void checkout("teams")}
                className="w-full h-11 rounded-xl text-sm font-semibold text-(--t-text-primary) disabled:opacity-60"
                style={{ border: "1px solid var(--t-border)" }}
              >
                Upgrade to Teams
              </button>
            )}

            <button
              data-account-manage-billing
              onClick={() => void openPortal()}
              className="w-full h-11 rounded-xl text-sm font-medium text-(--t-text-primary) flex items-center justify-center gap-2"
              style={{ border: "1px solid var(--t-border)" }}
            >
              <Icon icon="lucide:external-link" width={16} />
              {isPro ? "Manage billing" : "View all plans"}
            </button>
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
              Sign in to sync
            </button>
          ) : confirming ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-(--t-text-dim)">Sign out? Your encrypted vault is removed from this device and re-synced when you sign back in.</p>
              <button
                data-account-signout-confirm
                onClick={() => { void logout(); pop(); }}
                className="w-full h-11 rounded-xl text-sm font-semibold"
                style={{ background: "var(--t-danger, #e5484d)", color: "#fff" }}
              >
                Sign out
              </button>
              <button onClick={() => setConfirming(false)} className="w-full h-11 rounded-xl text-sm font-medium text-(--t-text-primary)" style={{ border: "1px solid var(--t-border)" }}>
                Cancel
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
              Sign out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
