import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNotificationStore } from "@/stores/notificationStore";
import { useAppLockStore } from "@/stores/appLockStore";
import { ProgressToast } from "./ProgressToast";
import { NotificationBadge, NotificationSourceLabel } from "./NotificationBadge";
import { STRIP_SURFACE, StripDismissButton, StripTextButton, ToastStrip } from "./ToastStrip";
import type { ToastEntry } from "@/stores/notificationStore";
import { useIsMobile } from "@/utils/platform";
import MobileSnackbarHost from "@/components/mobile/MobileSnackbar";

type TimerInfo = { id: ReturnType<typeof setTimeout>; remaining: number; startedAt: number; original: number };

function RegularToast({
  toast,
  onDismiss,
  pluginUnloaded,
  leaving,
}: {
  toast: ToastEntry;
  onDismiss: () => void;
  pluginUnloaded: boolean;
  leaving: boolean;
}) {
  return (
    <ToastStrip leaving={leaving}>
      <div className="flex items-center gap-2.5">
        <NotificationBadge source={toast.source} host={toast.host} severity={toast.severity} halo={STRIP_SURFACE} />
        {/* Wraps rather than truncating: a refusal that explains itself is longer than one line. */}
        <span
          className="flex-1 min-w-0 leading-5 break-words text-(--t-text-primary)"
          style={{ display: "-webkit-box", WebkitLineClamp: 8, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          title={toast.message}
        >
          {toast.message}
        </span>
        <NotificationSourceLabel source={toast.source} host={toast.host} className="shrink-0 max-w-[9rem]" />
        {toast.action && <StripTextButton label={toast.action.label} onClick={toast.action.onClick} disabled={pluginUnloaded} />}
        <StripDismissButton onClick={onDismiss} />
      </div>
    </ToastStrip>
  );
}

export function NotificationToastContainer() {
  const locked = useAppLockStore((s) => s.kind !== null);
  const mobile = useIsMobile();
  if (locked) return null;
  // Phones: plain toasts are M3 snackbars (one at a time, above the bottom chrome).
  return mobile ? <><MobileSnackbarHost /><ToastStack only="progress" /></> : <ToastStack />;
}

function ToastStack({ only }: { only?: ToastEntry["type"] }) {
  const { t } = useTranslation();
  const all = useNotificationStore((s) => s.toasts);
  const toasts = useMemo(() => (only ? all.filter((x) => x.type === only) : all), [all, only]);
  const dismissToast = useNotificationStore((s) => s.dismissToast);
  const updateToast = useNotificationStore((s) => s.updateToast);
  const timers = useRef<Map<string, TimerInfo>>(new Map());
  const [hovered, setHovered] = useState(false);
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  const fadingIdsRef = useRef<Set<string>>(new Set());

  const LEAVE_MS = 160;

  const dismissWithFade = (id: string) => {
    fadingIdsRef.current.add(id);
    setFadingIds(new Set(fadingIdsRef.current));
    setTimeout(() => {
      dismissToast(id);
      fadingIdsRef.current.delete(id);
      setFadingIds(new Set(fadingIdsRef.current));
    }, LEAVE_MS);
  };

  const scheduleTimer = (id: string, remaining: number, original?: number) => {
    const timer = setTimeout(() => {
      dismissWithFade(id);
      timers.current.delete(id);
    }, remaining);
    timers.current.set(id, { id: timer, remaining, startedAt: Date.now(), original: original ?? remaining });
  };

  // Sync timers with toast list
  useEffect(() => {
    const activeIds = new Set(toasts.map((t) => t.id));

    for (const [id, info] of timers.current.entries()) {
      if (!activeIds.has(id)) {
        clearTimeout(info.id);
        timers.current.delete(id);
      }
    }

    for (const toast of toasts) {
      if (!timers.current.has(toast.id) && toast.duration > 0 && !hovered) {
        scheduleTimer(toast.id, toast.duration);
      }
    }
  }, [toasts]);

  // Handle hover pause/resume
  useEffect(() => {
    if (hovered) {
      for (const [id, info] of timers.current.entries()) {
        clearTimeout(info.id);
        timers.current.set(id, { ...info });
      }
    } else {
      // Reset all timers to their original full duration
      for (const [id, info] of timers.current.entries()) {
        clearTimeout(info.id);
        scheduleTimer(id, info.original, info.original);
      }
    }
  }, [hovered]);

  // Timeout checker for progress toasts
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      for (const toast of useNotificationStore.getState().toasts) {
        if (toast.type === "progress" && !toast.finished && toast.timedOutAt && now > toast.timedOutAt) {
          updateToast(toast.id, { finished: true, finishedSeverity: "error", message: t("notifications.progressToast.timedOut") });
        }
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      for (const info of timers.current.values()) clearTimeout(info.id);
    };
  }, []);

  // Auto-dismiss finished progress toasts
  useEffect(() => {
    for (const toast of toasts) {
      if (toast.type === "progress" && toast.finished && toast.finishedSeverity !== "error") {
        if (!timers.current.has(toast.id)) {
          scheduleTimer(toast.id, toast.duration > 0 ? toast.duration : 2000);
        }
      }
    }
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-8 right-3 flex flex-col items-end gap-1 z-50 pointer-events-none"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {toasts.map((toast) => {
        const fading = fadingIds.has(toast.id);
        if (toast.type === "progress") {
          return (
            <ProgressToast
              key={toast.id}
              toast={toast}
              onDismiss={() => {
                toast.onCancel?.();
                dismissWithFade(toast.id);
              }}
              pluginUnloaded={false}
              leaving={fading}
            />
          );
        }
        return (
          <RegularToast
            key={toast.id}
            toast={toast}
            onDismiss={() => dismissWithFade(toast.id)}
            pluginUnloaded={false}
            leaving={fading}
          />
        );
      })}
    </div>
  );
}
