import { useEffect } from "react";
import { useMobileNavStore } from "@/stores/mobileNavStore";

/**
 * Hardware-back for the mobile shell. WRY routes the Android back button to
 * WebView history-back when a back entry exists; we keep one history "trap"
 * entry per unit of in-app back-depth and translate each popstate →
 * mobileNav.back().
 *
 * Android-WebView quirk (found on device): pushing a history entry *during or
 * after* a popstate dispatch does NOT reliably register a new back target — the
 * next hardware back then escapes and backgrounds the app one press early. So we
 * never push inside popstate. Instead we pre-push one trap per back-depth unit
 * as in-app navigation deepens (a reliable, normal click-handler context); each
 * hardware back consumes exactly one pre-pushed trap. The popstate handler only
 * decrements our counter and drives mobileNav.back().
 *
 * Traps are only ever added, never removed, so in-app back navigation (the back
 * arrow / scrim tap) can leave a few stale traps — each costs one harmless no-op
 * back press before the app backgrounds. The hardware-back path itself is exact.
 */
export function useAndroidBack() {
  useEffect(() => {
    let pushed = 0;

    const wantTraps = () => {
      const { tab, stack, sheet } = useMobileNavStore.getState();
      return (tab !== "hosts" ? 1 : 0) + stack.length + (sheet !== null ? 1 : 0);
    };

    const syncTraps = () => {
      // Only ADD traps, only from in-app navigation. Never inside popstate (see above).
      const want = wantTraps();
      while (pushed < want) {
        history.pushState({ v: "voltius-back" }, "");
        pushed++;
      }
    };

    const onPop = () => {
      if (pushed > 0) pushed--;
      // back() mutates the store → subscription runs syncTraps, which is a no-op
      // now (want decreased in lock-step with pushed). No push happens here.
      useMobileNavStore.getState().back();
    };

    const unsub = useMobileNavStore.subscribe(syncTraps);
    window.addEventListener("popstate", onPop);
    syncTraps();
    return () => {
      unsub();
      window.removeEventListener("popstate", onPop);
    };
  }, []);
}
