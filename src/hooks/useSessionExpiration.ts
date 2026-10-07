import { useEffect } from "react";
import { getAccountMode } from "@/services/account";
import { lockApp } from "@/services/appLock";
import { isLeaveLockSuppressed } from "@/services/leaveLockSuppression";
import { useAppLockStore } from "@/stores/appLockStore";
import { useSecurityStore } from "@/stores/securityStore";
import { canLockApp } from "@/utils/accountMode";
import { IMMEDIATELY } from "@/utils/sessionTimeout";

const CHECK_INTERVAL_MS = 5000;
const IMMEDIATE_IDLE_MINUTES = 5;
const ACTIVITY_EVENTS = ["pointerdown", "mousemove", "keydown", "touchstart"] as const;

export function useSessionExpiration(ready = true): void {
  const sessionTimeoutMinutes = useSecurityStore((s) => s.sessionTimeoutMinutes);
  const systemAuthUnlock = useSecurityStore((s) => s.systemAuthUnlock);

  useEffect(() => {
    if (!ready || sessionTimeoutMinutes === null || sessionTimeoutMinutes < 0) return;

    const immediate = sessionTimeoutMinutes === IMMEDIATELY;
    const timeoutMs = (immediate ? IMMEDIATE_IDLE_MINUTES : sessionTimeoutMinutes) * 60_000;
    let lastActivityAt = Date.now();
    let lockable = false;
    let disposed = false;
    let lockInProgress = false;
    let unlistenResize: (() => void) | null = null;

    getAccountMode()
      .then((mode) => { lockable = canLockApp(mode, systemAuthUnlock); })
      .catch(() => { lockable = false; });

    const lockNow = () => {
      if (lockInProgress || disposed || !lockable || useAppLockStore.getState().kind) return;
      lockInProgress = true;
      lockApp()
        .catch(() => {})
        .finally(() => {
          lockInProgress = false;
          lastActivityAt = Date.now();
        });
    };

    const lockOnLeave = () => {
      if (immediate && !isLeaveLockSuppressed()) lockNow();
    };

    const checkIdle = () => {
      if (Date.now() - lastActivityAt >= timeoutMs) lockNow();
    };

    const recordActivity = () => {
      if (!lockInProgress && !disposed) lastActivityAt = Date.now();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") lockOnLeave();
      else checkIdle();
    };

    if (immediate) {
      import("@tauri-apps/api/window")
        .then(async ({ getCurrentWindow }) => {
          const win = getCurrentWindow();
          const unlisten = await win.onResized(() => {
            void win.isMinimized().then((min) => { if (min) lockOnLeave(); }).catch(() => {});
          });
          if (disposed) unlisten();
          else unlistenResize = unlisten;
        })
        .catch(() => {});
    }

    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, recordActivity, { passive: true });
    window.addEventListener("focus", checkIdle);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const intervalId = window.setInterval(checkIdle, CHECK_INTERVAL_MS);
    const unsubscribeLock = useAppLockStore.subscribe((s, prev) => {
      if (prev.kind && !s.kind) lastActivityAt = Date.now();
    });

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      unsubscribeLock();
      unlistenResize?.();
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, recordActivity);
      window.removeEventListener("focus", checkIdle);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [ready, sessionTimeoutMinutes, systemAuthUnlock]);
}
