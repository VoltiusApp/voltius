import { useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { usePromoStore } from "@/stores/promoStore";
import { pickLaunchPromo } from "@/services/promoPicker";
import { getServerCapability } from "@/services/serverCapabilities";
import { CAN_OPEN_CHECKOUT } from "@/services/distribution";

/**
 * Once per process, after the app is ready and no other launch modal is up:
 * load promo state, then open the promo the picker selects (if any).
 */
export function useLaunchPromo(ready: boolean) {
  const whatsNewOpen = useUIStore((s) => s.whatsNewOpen);
  const cloudAuthOpen = useUIStore((s) => s.cloudAuthOpen);

  useEffect(() => {
    if (!ready || whatsNewOpen || cloudAuthOpen) return;
    if (usePromoStore.getState().launchHandled) return;
    usePromoStore.setState({ launchHandled: true });
    (async () => {
      await useSubscriptionStore.getState().load().catch(() => {});
      await usePromoStore.getState().load().catch(() => {});
      const ui = useUIStore.getState();
      if (ui.whatsNewOpen || ui.cloudAuthOpen) return;
      const sub = useSubscriptionStore.getState();
      const promo = pickLaunchPromo({
        state: usePromoStore.getState().state,
        billingEnabled: getServerCapability("billingEnabled"),
        canCheckout: CAN_OPEN_CHECKOUT,
        signedIn: sub.accountMode === "server",
        tier: sub.tier,
        billingTier: sub.billingTier,
        seatTeam: sub.seatTeam,
        adminComped: false,
        now: Date.now(),
      });
      if (promo) usePromoStore.getState().open(promo, "launch");
    })();
  }, [ready, whatsNewOpen, cloudAuthOpen]);
}
