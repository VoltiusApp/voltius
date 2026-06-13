import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import MobilePanelHeader from "../panels/MobilePanelHeader";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useUIStore } from "@/stores/uiStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useEffectiveSyncStatus } from "@/hooks/useEffectiveSyncStatus";
import { syncStatusIcon, syncStatusColor } from "@/services/syncStatus";
import { getCurrentUserEmail, logout } from "@/services/account";

const TIER_LABEL: Record<string, string> = { free: "Free", pro: "Pro", teams: "Teams", business: "Business" };

export default function MobileAccountPage() {
  const pop = useMobileNavStore((s) => s.pop);
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);
  const tier = useSubscriptionStore((s) => s.tier);
  const accountMode = useSubscriptionStore((s) => s.accountMode);
  const sync = useEffectiveSyncStatus();
  const [email, setEmail] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { void getCurrentUserEmail().then(setEmail); }, []);

  const signedIn = accountMode === "server";

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
        <Row icon="lucide:badge-check" label="Plan" value={TIER_LABEL[tier] ?? tier} />
        <Row
          icon={syncStatusIcon(sync.status)}
          label="Cloud sync"
          value={sync.configured ? sync.status : "Off"}
          valueColor={sync.configured ? syncStatusColor(sync.status) : undefined}
        />

        <div className="p-4">
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
