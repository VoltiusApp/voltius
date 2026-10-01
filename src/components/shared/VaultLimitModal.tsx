import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/shared/Modal";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useUIStore } from "@/stores/uiStore";
import { openBillingCheckout } from "@/services/billingCheckout";

/** Free accounts keep the one vault they start with; more vaults are a Pro feature. */
export function useVaultLimitReached(): boolean {
  const isPro = useSubscriptionStore((s) => s.isPro);
  const vaultCount = useVaultStore((s) => s.vaults.length);
  return !isPro && vaultCount >= 1;
}

export function VaultLimitModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const isCloudAccount = useSubscriptionStore((s) => s.accountMode === "server");
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);

  const upgrade = async () => {
    if (await openBillingCheckout("pro")) onClose();
  };
  const signIn = () => {
    onClose();
    openCloudAuth("signin");
  };

  return (
    <Modal onClose={onClose} blur>
      <div
        className="flex flex-col gap-4 bg-(--t-bg-base) border border-(--t-border) p-6"
        style={{ width: "min(25rem, 92vw)", borderRadius: "0.933rem", boxShadow: "var(--t-elev-3)" }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}
          >
            <Icon icon="lucide:vault" width={20} style={{ color: "var(--t-accent)" }} />
          </div>
          <div>
            <p className="text-base font-semibold text-(--t-text-primary) mb-1">
              {t("layout.vaultSidebar.multipleVaultsTitle")}
            </p>
            <p className="text-sm text-(--t-text-muted) leading-relaxed">
              {t("layout.vaultSidebar.multipleVaultsBody")}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={isCloudAccount ? () => void upgrade() : signIn}
            className="w-full py-2.5 rounded-lg text-sm font-semibold bg-(--t-accent) text-white hover:opacity-90 transition-opacity"
          >
            {isCloudAccount ? t("layout.vaultSidebar.upgradeToPro") : t("layout.vaultSidebar.signInOrCreate")}
          </button>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg text-sm text-(--t-text-muted) hover:text-(--t-text-primary) transition-colors"
          >
            {t("layout.vaultSidebar.maybeLater")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
