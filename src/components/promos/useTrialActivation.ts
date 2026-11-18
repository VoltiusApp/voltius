import { useState } from "react";
import { useTranslation } from "react-i18next";
import { activateTrial, recordPromoEvent, type PromoSource } from "@/services/promos";
import { openBillingCheckout } from "@/services/billingCheckout";
import { usePromoStore } from "@/stores/promoStore";
import { APP_SOURCE, useNotificationStore } from "@/stores/notificationStore";

export type PromoCloseReason = "dismissed" | "activated";

export interface PromoModalProps {
  source: PromoSource;
  onClose: (reason: PromoCloseReason) => void;
}

/** Telemetry for a primary-CTA press on whichever promo is showing. */
export function recordPromoClick(): void {
  const c = usePromoStore.getState().current;
  if (c) void recordPromoEvent(c.promo, "clicked", c.source, c.occurrence);
}

function toast(message: string, severity: "success" | "error"): void {
  useNotificationStore.getState().addToast({ source: APP_SOURCE, type: "toast", message, severity, duration: 5000 });
}

/** The trial CTA of the Pro and Teams promos. An unverified email turns it into
 *  "verify first", which still calls `activateTrial`: its 403 path opens the existing
 *  verification modal, and it simply succeeds if the address was verified meanwhile. */
export function useTrialActivation(plan: "pro" | "teams", source: PromoSource, onClose: (r: PromoCloseReason) => void) {
  const { t } = useTranslation();
  const knownUnverified = usePromoStore((s) => s.state?.emailVerified === false);
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);

  async function activate() {
    if (busy) return;
    recordPromoClick();
    setBusy(true);
    const result = await activateTrial(plan, source);
    setBusy(false);
    switch (result) {
      case "ok":
        onClose("activated");
        toast(t(`shared.promos.${plan}.activated`), "success");
        break;
      case "unavailable":
        // The offer is gone (already used, or a plan started elsewhere): nothing was dismissed, checkout takes over.
        onClose("activated");
        void usePromoStore.getState().load();
        void openBillingCheckout(plan);
        break;
      case "email_unverified":
        setRefused(true);
        break;
      default:
        toast(t("shared.promos.activateFailed"), "error");
    }
  }

  return { activate, busy, verifyFirst: knownUnverified || refused };
}
