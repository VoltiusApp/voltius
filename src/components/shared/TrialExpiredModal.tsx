import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { UpgradeStrip } from "@/components/shared/UpgradeStrip";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { openBillingCheckout } from "@/services/billingCheckout";

const STORAGE_KEY = "voltius_trial_expired_shown";

const PRO_PERKS = [
  { id: "realtimeSync", icon: "lucide:refresh-cw" },
  { id: "unlimitedVaults", icon: "lucide:vault" },
  { id: "terminalSharing", icon: "lucide:users-round" },
];

export function TrialExpiredModal() {
  const { t } = useTranslation();
  const { tier, trialEndsAt, trialUsed } = useSubscriptionStore();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // The server clears trial_ends_at once a trial lapses, so a past date is a
    // bonus signal, never a precondition — requiring it hid this modal from
    // every expired account.
    if (!trialUsed) return;
    if (tier !== "free") return;
    if (trialEndsAt && trialEndsAt > new Date()) return;
    if (localStorage.getItem(STORAGE_KEY)) return;

    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(true);
  }, [tier, trialEndsAt, trialUsed]);

  if (!visible) return null;

  function upgrade(plan: "pro" | "teams") {
    void openBillingCheckout(plan);
    setVisible(false);
  }

  return (
    <Modal onClose={() => setVisible(false)}>
      <ModalCard className="flex flex-col gap-5 animate-fadeIn p-8" style={{ width: "min(28rem, 92vw)" }}>
        <div>
          <p className="text-base font-semibold text-(--t-text-primary) mb-1">
            {t("shared.trialExpiredModal.title")}
          </p>
          <p className="text-sm text-(--t-text-muted)">{t("shared.trialExpiredModal.subtitle")}</p>
        </div>

        <ul className="flex flex-col gap-2.5">
          {PRO_PERKS.map(({ id, icon }) => (
            <li key={id} className="flex items-center gap-2.5">
              <Icon icon={icon} width={14} className="shrink-0 text-(--t-text-muted)" />
              <span className="text-sm text-(--t-text-primary)">
                {t(`settings.account.plan.feature.${id}`)}
              </span>
            </li>
          ))}
        </ul>

        <p className="text-xs text-(--t-text-muted) leading-relaxed">
          {t("shared.trialExpiredModal.freeNote")}
        </p>

        <UpgradeStrip
          variant="neutral"
          label={t("shared.trialExpiredModal.teamsPrompt")}
          buttonLabel={t("settings.account.plan.teamsButton")}
          onClick={() => upgrade("teams")}
        />

        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => upgrade("pro")}
            className="btn btn-primary px-4 py-2 rounded-lg text-sm font-semibold"
          >
            {t("shared.trialExpiredModal.upgradeButton")}
          </button>
          <button
            onClick={() => setVisible(false)}
            className="text-xs text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
          >
            {t("shared.trialExpiredModal.laterButton")}
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
