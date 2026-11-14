import { useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { usePromoStore } from "@/stores/promoStore";
import { pickLaunchPromo } from "@/services/promoPicker";
import { getServerCapability, refreshServerCapabilities } from "@/services/serverCapabilities";
import { CAN_OPEN_CHECKOUT } from "@/services/distribution";

/** Guards against two effect runs loading and picking concurrently. */
let inFlight = false;

/**
 * Once per process, after the app is ready and no other launch modal is up:
 * load promo state, then open the promo the picker selects (if any). A modal
 * that is open (or opens while loading) defers the pick until it closes, and a
 * signed-out launch defers it until the first sign-in.
 */
export function useLaunchPromo(ready: boolean) {
  const whatsNewOpen = useUIStore((s) => s.whatsNewOpen);
  const cloudAuthOpen = useUIStore((s) => s.cloudAuthOpen);
  const accountMode = useSubscriptionStore((s) => s.accountMode);

  useEffect(() => {
    if (accountMode !== "server") usePromoStore.setState({ state: null });
    else if (usePromoStore.getState().launchHandled) void usePromoStore.getState().load().catch(() => {});
  }, [accountMode]);

  useEffect(() => {
    if (!ready || whatsNewOpen || cloudAuthOpen) return;
    if (inFlight || usePromoStore.getState().launchHandled) return;
    inFlight = true;
    (async () => {
      try {
        await Promise.all([
          useSubscriptionStore.getState().load().catch(() => {}),
          refreshServerCapabilities().catch(() => {}),
          usePromoStore.getState().load().catch(() => {}),
        ]);
        const ui = useUIStore.getState();
        if (ui.whatsNewOpen || ui.cloudAuthOpen) return;
        const sub = useSubscriptionStore.getState();
        // Signed out: the pick waits for the first sign-in.
        if (sub.accountMode !== "server") return;
        usePromoStore.setState({ launchHandled: true });
        const promo = pickLaunchPromo({
          state: usePromoStore.getState().state,
          billingEnabled: getServerCapability("billingEnabled"),
          canCheckout: CAN_OPEN_CHECKOUT,
          signedIn: true,
          tier: sub.tier,
          billingTier: sub.billingTier,
          seatTeam: sub.seatTeam,
          adminComped: false,
          now: Date.now(),
        });
        if (promo) usePromoStore.getState().open(promo, "launch");
      } finally {
        inFlight = false;
      }
    })();
  }, [ready, whatsNewOpen, cloudAuthOpen, accountMode]);
}
