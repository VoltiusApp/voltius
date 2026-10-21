import { useEffect } from "react";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useUIStore } from "@/stores/uiStore";
import { useBackStackStore } from "@/hooks/useBackInterceptor";
import { planBack, type BackAction } from "@/hooks/backCore";

/** Native side (NativeBack.kt, `addJavascriptInterface`): absent outside the Android shell. */
interface NativeBackBridge {
  setEnabled(enabled: boolean): void;
}

declare global {
  interface Window {
    /** Called by the native OnBackPressedCallback: closes the topmost thing, true if it did. */
    __voltiusBack?: () => boolean;
    VoltiusBack?: NativeBackBridge;
  }
}

const currentAction = (): BackAction | null => {
  const { tab, stack, sheet } = useMobileNavStore.getState();
  return planBack({
    interceptors: useBackStackStore.getState().stack,
    settings: useUIStore.getState(),
    nav: { tab, stack, sheet },
  });
};

/** Run one back step. Returns false when nothing is left to close (root). */
export function runBack(): boolean {
  const action = currentAction();
  if (!action) return false;
  switch (action.kind) {
    case "interceptor":
      useBackStackStore.getState().stack.find((i) => i.id === action.id)?.close();
      return true;
    case "settings-subpage":
      useUIStore.getState().setSettingsSubPage(null);
      return true;
    case "settings":
      useUIStore.getState().setSettingsOpen(false);
      return true;
    case "nav":
      return useMobileNavStore.getState().back();
  }
}

/**
 * Hardware back for the mobile shell (Android only: MobileShell is Android-only).
 *
 * The native shell owns an OnBackPressedCallback (NativeBack.kt). While it is
 * enabled, a press calls `window.__voltiusBack()`, which closes one thing (see
 * backCore.planBack) and tells native whether it did. We keep the callback
 * enabled iff something can be closed, so at root the press goes to the system
 * default (and Android's predictive back can preview it). No WebView history is
 * involved.
 */
export function useAndroidBack() {
  useEffect(() => {
    let sent: boolean | null = null;
    const sync = () => {
      const want = currentAction() !== null;
      if (want === sent) return;
      sent = want;
      window.VoltiusBack?.setEnabled(want);
    };

    window.__voltiusBack = () => {
      const consumed = runBack();
      // Native disables itself on false; mirror that so the next change re-sends.
      if (!consumed) sent = false;
      sync();
      return consumed;
    };

    const unsubs = [
      useMobileNavStore.subscribe(sync),
      useUIStore.subscribe(sync),
      useBackStackStore.subscribe(sync),
    ];
    sync();
    return () => {
      unsubs.forEach((u) => u());
      delete window.__voltiusBack;
      window.VoltiusBack?.setEnabled(false);
    };
  }, []);
}
