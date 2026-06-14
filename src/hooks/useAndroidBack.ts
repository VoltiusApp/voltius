import { useEffect } from "react";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useUIStore } from "@/stores/uiStore";

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

    // Settings is a full-screen overlay in its own store: +1 for the list, +1 more for a drill-down.
    const settingsDepth = () => {
      const { settingsOpen, settingsSubPage } = useUIStore.getState();
      return settingsOpen ? 1 + (settingsSubPage ? 1 : 0) : 0;
    };

    const wantTraps = () => {
      const { tab, stack, sheet } = useMobileNavStore.getState();
      return (tab !== "hosts" ? 1 : 0) + stack.length + (sheet !== null ? 1 : 0) + settingsDepth();
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
      // Settings overlays the shell, so it consumes back first: drill-down → list → closed.
      // Each step mutates a store → subscription runs syncTraps, a no-op now (want decreased
      // in lock-step with pushed). No push happens here.
      const ui = useUIStore.getState();
      if (ui.settingsOpen) {
        if (ui.settingsSubPage) ui.setSettingsSubPage(null);
        else ui.setSettingsOpen(false);
        return;
      }
      useMobileNavStore.getState().back();
    };

    const unsubNav = useMobileNavStore.subscribe(syncTraps);
    const unsubUi = useUIStore.subscribe(syncTraps);
    window.addEventListener("popstate", onPop);
    syncTraps();
    return () => {
      unsubNav();
      unsubUi();
      window.removeEventListener("popstate", onPop);
    };
  }, []);
}
