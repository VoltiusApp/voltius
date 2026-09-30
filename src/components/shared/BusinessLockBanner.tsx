import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { openBillingCheckout } from "@/services/billingCheckout";
import { UpgradeStrip } from "@/components/shared/UpgradeStrip";

export function UpgradeAction({ teamId, look }: { teamId: string; look: "strip" | "button" | "link" }) {
  const { t } = useTranslation();
  const { isOwner } = useBusinessLock(teamId);
  const upgrade = () => void openBillingCheckout("business");
  if (isOwner === false) {
    return look === "link" ? null : <p className="text-xs text-(--t-text-dim)">{t("shared.businessLock.ownerOnly")}</p>;
  }
  if (isOwner !== true) return null;
  if (look === "strip") {
    return <UpgradeStrip label={t("shared.businessLock.upgradeLabel")} buttonLabel={t("shared.businessLock.upgrade")} onClick={upgrade} />;
  }
  if (look === "link") {
    return <button type="button" onClick={upgrade} className="text-xs text-(--t-accent) shrink-0">{t("shared.businessLock.upgrade")}</button>;
  }
  return (
    <button type="button" onClick={upgrade} className="text-xs px-3 py-1.5 rounded-lg font-medium bg-(--t-accent) text-white">
      {t("shared.businessLock.upgrade")}
    </button>
  );
}

export function BusinessLapseNotice({ teamId, message, removeLabel, onRemove }: {
  teamId: string; message: string; removeLabel: string; onRemove?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { locked } = useBusinessLock(teamId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!locked) return null;

  const remove = async () => {
    if (!confirming) { setConfirming(true); return; }
    setBusy(true);
    try { await onRemove?.(); } finally { setBusy(false); setConfirming(false); }
  };

  return (
    <div className="space-y-2 mb-2">
      <div className="flex items-start gap-2">
        <Icon icon="lucide:lock" width={14} className="mt-0.5 shrink-0 text-(--t-text-dim)" />
        <p className="text-xs text-(--t-text-primary)">{message}</p>
      </div>
      <UpgradeAction teamId={teamId} look="strip" />
      {onRemove && (
        <button
          type="button"
          onClick={() => void remove()}
          onBlur={() => setConfirming(false)}
          disabled={busy}
          className="text-xs text-(--t-status-error) disabled:opacity-50"
        >
          {confirming ? t("shared.businessLock.confirmClear") : removeLabel}
        </button>
      )}
    </div>
  );
}

export function BusinessLockLine({ teamId, label }: { teamId: string; label: string }) {
  const { locked } = useBusinessLock(teamId);
  if (!locked) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-(--t-text-dim)">
      <Icon icon="lucide:lock" width={12} className="shrink-0" />
      <span className="flex-1">{label}</span>
      <UpgradeAction teamId={teamId} look="link" />
    </div>
  );
}
