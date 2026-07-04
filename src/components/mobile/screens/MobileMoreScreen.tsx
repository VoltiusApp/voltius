import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import MobileHeader from "../MobileHeader";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useUIStore } from "@/stores/uiStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { getCurrentUserEmail } from "@/services/account";
import type { MorePage } from "@/stores/mobileNavCore";

function getPages(t: TFunction): { page: MorePage; label: string; icon: string }[] {
  return [
    { page: "keychain",        label: t("mobile.morePages.keychain"),        icon: "lucide:key-round" },
    { page: "port-forwarding", label: t("mobile.morePages.portForwarding"),  icon: "lucide:arrow-left-right" },
    { page: "known-hosts",     label: t("mobile.morePages.knownHosts"),      icon: "lucide:fingerprint-pattern" },
    { page: "members",         label: t("mobile.morePages.members"),         icon: "lucide:users-round" },
    { page: "logs",            label: t("mobile.morePages.logs"),            icon: "lucide:scroll-text" },
  ];
}

export default function MobileMoreScreen() {
  const { t } = useTranslation();
  const PAGES = getPages(t);
  const TIER_LABEL: Record<string, string> = {
    free: t("mobile.account.tier.free"),
    pro: t("mobile.account.tier.pro"),
    teams: t("mobile.account.tier.teams"),
    business: t("mobile.account.tier.business"),
  };
  const push = useMobileNavStore((s) => s.push);
  const openSettings = useUIStore((s) => s.openSettings);
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);
  const accountMode = useSubscriptionStore((s) => s.accountMode);
  const tier = useSubscriptionStore((s) => s.tier);
  const [email, setEmail] = useState<string | null>(null);

  const signedIn = accountMode === "server";
  useEffect(() => { if (signedIn) void getCurrentUserEmail().then(setEmail); }, [signedIn]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <MobileHeader />
      <div className="flex-1 overflow-y-auto py-2">
        {/* Account block */}
        {signedIn ? (
          <button
            data-more-account
            className="w-full flex items-center gap-3 px-4 py-3 mb-1 text-left active:bg-(--t-bg-card)"
            onClick={() => push({ kind: "account" })}
          >
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--t-accent)" }}>
              <Icon icon="lucide:user" width={18} className="text-white" />
            </div>
            <span className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium text-(--t-text-primary) truncate">{email ?? t("mobile.account.title")}</span>
              <span className="text-xs text-(--t-text-dim)">{t("mobile.more.planLabel", { tier: TIER_LABEL[tier] ?? tier })}</span>
            </span>
            <Icon icon="lucide:chevron-right" width={16} className="text-(--t-text-dim)" />
          </button>
        ) : (
          <button
            data-more-signin
            className="w-full flex items-center gap-3 px-4 py-3 mb-1 text-left active:bg-(--t-bg-card)"
            onClick={() => openCloudAuth("signin")}
          >
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}>
              <Icon icon="lucide:log-in" width={18} className="text-(--t-text-dim)" />
            </div>
            <span className="flex-1 text-sm font-medium text-(--t-text-primary)">{t("mobile.account.signInToSync")}</span>
            <Icon icon="lucide:chevron-right" width={16} className="text-(--t-text-dim)" />
          </button>
        )}
        <div className="mx-4 my-1 border-t" style={{ borderColor: "var(--t-border)" }} />

        {PAGES.map((p) => (
          <button key={p.page} data-more-page={p.page}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-(--t-bg-card)"
            onClick={() => push({ kind: "more-page", page: p.page })}>
            <Icon icon={p.icon} width={20} className="text-(--t-text-dim)" />
            <span className="flex-1 text-sm font-medium text-(--t-text-primary)">{p.label}</span>
            <Icon icon="lucide:chevron-right" width={16} className="text-(--t-text-dim)" />
          </button>
        ))}
        <div className="mx-4 my-2 border-t" style={{ borderColor: "var(--t-border)" }} />
        <button data-more-page="settings"
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-(--t-bg-card)"
          onClick={() => openSettings()}>
          <Icon icon="lucide:settings" width={20} className="text-(--t-text-dim)" />
          <span className="flex-1 text-sm font-medium text-(--t-text-primary)">{t("mobile.more.settings")}</span>
        </button>
      </div>
    </div>
  );
}
