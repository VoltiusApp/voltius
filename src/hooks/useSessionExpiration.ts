import { useEffect } from "react";
import { getAccountMode, lockVaultSession } from "@/services/account";
import { useSecurityStore } from "@/stores/securityStore";

const CHECK_INTERVAL_MS = 5000;

export function useSessionExpiration(): void {
  const sessionTimeoutMinutes = useSecurityStore((s) => s.sessionTimeoutMinutes);

  useEffect(() => {
    if (!sessionTimeoutMinutes || sessionTimeoutMinutes <= 0) return;

    const timeoutMs = sessionTimeoutMinutes * 60_000;
    let lastActivityAt = Date.now();
    let lockable = false;
    let disposed = false;
    let lockInProgress = false;

    getAccountMode()
      .then((mode) => {
        lockable = mode === "local" || mode === "server";
      })
      .catch(() => {
        lockable = false;
      });

    const lockNow = async () => {
      if (lockInProgress || disposed || !lockable) return;
      lockInProgress = true;
      try {
        await lockVaultSession();
      } finally {
        if (!disposed) window.location.reload();
      }
    };

    const checkIdle = () => {
      if (!lockable || lockInProgress || disposed) return;
      if (Date.now() - lastActivityAt >= timeoutMs) {
        lockNow().catch(() => {
          lockInProgress = false;
        });
      }
    };

    const recordActivity = () => {
      if (lockInProgress || disposed) return;
      lastActivityAt = Date.now();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkIdle();
    };

    window.addEventListener("pointerdown", recordActivity, { passive: true });
    window.addEventListener("mousemove", recordActivity, { passive: true });
    window.addEventListener("keydown", recordActivity);
    window.addEventListener("focus", checkIdle);
    window.addEventListener("touchstart", recordActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);

    const intervalId = window.setInterval(checkIdle, CHECK_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("mousemove", recordActivity);
      window.removeEventListener("keydown", recordActivity);
      window.removeEventListener("focus", checkIdle);
      window.removeEventListener("touchstart", recordActivity);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [sessionTimeoutMinutes]);
}