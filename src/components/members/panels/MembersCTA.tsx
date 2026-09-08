import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { openBillingCheckout } from "@/services/billingCheckout";

export function SignInToCloudCTA({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[320px] gap-5">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
        <Icon icon="lucide:cloud" width={28} style={{ color: "var(--t-accent)" }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium mb-1 text-(--t-text-primary)">{t("members.cta.signInTitle")}</p>
        <p className="text-xs max-w-[240px] text-(--t-text-dim)">
          {t("members.cta.signInDesc")}
        </p>
      </div>
      <button
        onClick={onSignIn}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: "var(--t-accent)" }}
      >
        {t("members.cta.signInBtn")}
      </button>
    </div>
  );
}

export function UpgradeToTeamsCTA() {
  const { t } = useTranslation();
  const openCheckout = async () => {
    await openBillingCheckout("teams");
  };

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[320px] gap-5">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
        <Icon icon="lucide:users-round" width={28} style={{ color: "var(--t-accent)" }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium mb-1 text-(--t-text-primary)">{t("members.cta.upgradeTitle")}</p>
        <p className="text-xs max-w-[220px] text-(--t-text-dim)">
          {t("members.cta.upgradeDesc")}
        </p>
      </div>
      <button
        onClick={() => void openCheckout()}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: "var(--t-accent)" }}
      >
        {t("members.cta.upgradeBtn")}
      </button>
    </div>
  );
}
