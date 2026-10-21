import { useEffect } from "react";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useUIStore } from "@/stores/uiStore";
import { useBackStackStore } from "@/hooks/useBackInterceptor";
import { planBack, type BackAction } from "@/hooks/backCore";
import {
  commitBackPreview,
  onBackProgress,
  type BackPreviewTarget,
  type BackProgressEvent,
  type PeekLayer,
} from "@/hooks/predictiveBack";

/** Native side (NativeBack.kt, `addJavascriptInterface`): absent outside the Android shell. */
interface NativeBackBridge {
  setEnabled(enabled: boolean): void;
}

declare global {
  interface Window {
    /** Called by the native OnBackPressedCallback: closes the topmost thing, true if it did. */
    __voltiusBack?: () => boolean;
    /** Predictive back gesture (start / progress / cancel) from NativeBack.kt. */
    __voltiusBackProgress?: (ev: BackProgressEvent) => void;
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

const interceptor = (id: number) => useBackStackStore.getState().stack.find((i) => i.id === id);

/** Run one back step (`action`, default: the current one). Returns false when nothing is left to close (root). */
export function runBack(action: BackAction | null = currentAction()): boolean {
  if (!action) return false;
  switch (action.kind) {
    case "interceptor":
      interceptor(action.id)?.close();
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

// Every page layer here plays a page transition on close, which takes the gesture's pose over.
const pageTarget = (el: Element | null | undefined, peek?: PeekLayer): BackPreviewTarget | null =>
  el instanceof HTMLElement ? { el, kind: "page", peek, handoff: true } : null;

/** The element a predictive-back preview of `action` animates, if it has one. */
function previewTarget(action: BackAction): BackPreviewTarget | null {
  switch (action.kind) {
    case "interceptor":
      return interceptor(action.id)?.preview?.() ?? null;
    case "settings-subpage":
      return pageTarget(document.querySelector("[data-mobile-settings-body]"), "settings");
    case "settings":
      return pageTarget(document.querySelector("[data-mobile-settings]"));
    case "nav": {
      // Pushed pages only: a nav sheet is a BottomSheet (interceptor), a tab switch has no preview.
      const { stack, sheet } = useMobileNavStore.getState();
      if (sheet || stack.length === 0) return null;
      // Mount the page (or tab screen) under the top one so the preview reveals it.
      return pageTarget(document.querySelector('[data-mobile-stack-page="top"]')?.firstElementChild, "stack");
    }
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
      const consumed = commitBackPreview() || runBack();
      // Native disables itself on false; mirror that so the next change re-sends.
      if (!consumed) sent = false;
      sync();
      return consumed;
    };

    window.__voltiusBackProgress = (ev) =>
      onBackProgress(ev, () => {
        const action = currentAction();
        return action && { target: previewTarget(action), close: () => runBack(action) };
      });

    const unsubs = [
      useMobileNavStore.subscribe(sync),
      useUIStore.subscribe(sync),
      useBackStackStore.subscribe(sync),
    ];
    sync();
    return () => {
      unsubs.forEach((u) => u());
      delete window.__voltiusBack;
      delete window.__voltiusBackProgress;
      window.VoltiusBack?.setEnabled(false);
    };
  }, []);
}
