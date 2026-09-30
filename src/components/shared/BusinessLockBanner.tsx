import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { openBillingCheckout } from "@/services/billingCheckout";
import { UpgradeStrip } from "@/components/shared/UpgradeStrip";

export function BusinessLockBanner({ teamId, onClear }: { teamId: string; onClear?: () => Promise<void> }) {
  const { t } = useTranslation();
  const { locked, isOwner } = useBusinessLock(teamId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!locked) return null;

  const clear = async () => {
    if (!confirming) { setConfirming(true); return; }
    setBusy(true);
    try { await onClear?.(); } finally { setBusy(false); setConfirming(false); }
  };

  return (
    <div className="space-y-2 mb-2">
      <div className="flex items-start gap-2">
        <Icon icon="lucide:lock" width={14} className="mt-0.5 shrink-0 text-(--t-text-dim)" />
        <div>
          <p className="text-xs font-medium text-(--t-text-primary)">{t("shared.businessLock.title")}</p>
          <p className="text-xs text-(--t-text-dim)">{t("shared.businessLock.body")}</p>
        </div>
      </div>
      {isOwner ? (
        <UpgradeStrip
          label={t("shared.businessLock.upgradeLabel")}
          buttonLabel={t("shared.businessLock.upgrade")}
          onClick={() => void openBillingCheckout("business")}
        />
      ) : (
        <p className="text-xs text-(--t-text-dim)">{t("shared.businessLock.ownerOnly")}</p>
      )}
      {onClear && (
        <button
          type="button"
          onClick={() => void clear()}
          onBlur={() => setConfirming(false)}
          disabled={busy}
          className="text-xs text-(--t-status-error) disabled:opacity-50"
        >
          {t(confirming ? "shared.businessLock.confirmClear" : "shared.businessLock.clear")}
        </button>
      )}
    </div>
  );
}
