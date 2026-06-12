import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useNotificationStore } from "@/stores/notificationStore";
import { ProgressToast } from "./ProgressToast";
import type { ToastEntry } from "@/stores/notificationStore";

type TimerInfo = { id: ReturnType<typeof setTimeout>; remaining: number; startedAt: number; original: number };

const SEVERITY_ICONS: Record<string, string> = {
  info: "lucide:info",
  success: "lucide:check-circle",
  warning: "lucide:triangle-alert",
  error: "lucide:x-circle",
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "var(--t-accent)",
  success: "var(--t-status-connected)",
  warning: "var(--t-status-warning)",
  error: "var(--t-status-error)",
};

const SEVERITY_BG: Record<string, string> = {
  info: "color-mix(in srgb, var(--t-accent) 8%, transparent)",
  success: "color-mix(in srgb, var(--t-status-connected) 8%, transparent)",
  warning: "color-mix(in srgb, var(--t-status-warning) 8%, transparent)",
  error: "color-mix(in srgb, var(--t-status-error) 8%, transparent)",
};

function RegularToast({
  toast,
  onDismiss,
  pluginUnloaded,
  fading,
  hovered,
  timerBarKey,
}: {
  toast: ToastEntry;
  onDismiss: () => void;
  pluginUnloaded: boolean;
  fading: boolean;
  hovered: boolean;
  timerBarKey: number;
}) {
  const color = SEVERITY_COLORS[toast.severity] ?? SEVERITY_COLORS.info;
  const bg = SEVERITY_BG[toast.severity] ?? SEVERITY_BG.info;
  const icon = SEVERITY_ICONS[toast.severity] ?? SEVERITY_ICONS.info;
  const hasDuration = toast.duration > 0;

  return (
    <div
      className={fading ? "animate-fadeOut" : "animate-fadeIn"}
      style={{ pointerEvents: "auto" }}
    >
      <div
        className="relative flex items-center gap-2 px-3 py-2 rounded-xl shadow-lg text-sm overflow-hidden"
        style={{
          minWidth: "16rem",
          maxWidth: "24rem",
          background: `color-mix(in srgb, var(--t-bg-card) 92%, transparent)`,
          border: `1px solid var(--t-border)`,
          borderLeft: `2px solid ${color}`,
          backdropFilter: "blur(4px)",
        }}
      >
        <Icon icon={icon} width={14} style={{ color, flexShrink: 0 }} />
        <span
          className="text-xs shrink-0 truncate"
          style={{ color: "var(--t-text-dim)", maxWidth: "5rem" }}
          title={toast.pluginName}
        >
          [{toast.pluginName.slice(0, 20)}]
        </span>
        <span className="flex-1 text-(--t-text-primary) truncate">{toast.message}</span>
        {toast.action && (
          <button
            onClick={toast.action.onClick}
            disabled={pluginUnloaded}
            className="shrink-0 px-1.5 py-0.5 rounded-sm text-xs font-medium transition-colors"
            style={{
              background: bg,
              color,
              opacity: pluginUnloaded ? 0.5 : 1,
              pointerEvents: pluginUnloaded ? "none" : "auto",
            }}
          >
            {toast.action.label}
          </button>
        )}
        <button
          onClick={onDismiss}
          className="w-4 h-4 flex items-center justify-center rounded-sm shrink-0 transition-colors"
          style={{ color: "var(--t-text-dim)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
        >
          <Icon icon="lucide:x" width={11} />
        </button>

        {/* Timer drain bar — full while hovered, drains on mouse-leave */}
        {hasDuration && !fading && (
          <div
            key={timerBarKey}
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "2px",
              transformOrigin: "left",
              background: color,
              opacity: 0.45,
              animation: hovered ? "none" : `toast-timer-drain ${toast.duration}ms linear forwards`,
              transform: hovered ? "scaleX(1)" : undefined,
            }}
          />
        )}
      </div>
    </div>
  );
}

export function NotificationToastContainer() {
  const toasts = useNotificationStore((s) => s.toasts);
  const dismissToast = useNotificationStore((s) => s.dismissToast);
  const updateToast = useNotificationStore((s) => s.updateToast);
  const timers = useRef<Map<string, TimerInfo>>(new Map());
  const [hovered, setHovered] = useState(false);
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  const fadingIdsRef = useRef<Set<string>>(new Set());
  const [timerResetCounter, setTimerResetCounter] = useState(0);

  const FADE_DURATION = 260;

  const dismissWithFade = (id: string) => {
    fadingIdsRef.current.add(id);
    setFadingIds(new Set(fadingIdsRef.current));
    setTimeout(() => {
      dismissToast(id);
      fadingIdsRef.current.delete(id);
      setFadingIds(new Set(fadingIdsRef.current));
    }, FADE_DURATION);
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
      setTimerResetCounter((c) => c + 1);
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
          updateToast(toast.id, { finished: true, finishedSeverity: "error", message: "Operation timed out" });
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
          scheduleTimer(toast.id, 2000);
        }
      }
    }
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 pointer-events-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {toasts.map((toast) => {
        const fading = fadingIds.has(toast.id);
        if (toast.type === "progress") {
          return (
            <div key={toast.id} className={fading ? "animate-fadeOut" : ""} style={{ pointerEvents: "auto" }}>
              <ProgressToast
                toast={toast}
                onDismiss={() => {
                  toast.onCancel?.();
                  dismissWithFade(toast.id);
                }}
                pluginUnloaded={false}
              />
            </div>
          );
        }
        return (
          <RegularToast
            key={toast.id}
            toast={toast}
            onDismiss={() => dismissWithFade(toast.id)}
            pluginUnloaded={false}
            fading={fading}
            hovered={hovered}
            timerBarKey={timerResetCounter}
          />
        );
      })}
    </div>
  );
}
