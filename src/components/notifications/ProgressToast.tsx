import { useTranslation } from "react-i18next";
import type { ToastEntry } from "@/stores/notificationStore";
import { NotificationBadge, NotificationSourceLabel } from "./NotificationBadge";
import { STRIP_SURFACE, StripDismissButton, StripTextButton, ToastStrip } from "./ToastStrip";

interface Props {
  toast: ToastEntry;
  onDismiss: () => void;
  pluginUnloaded: boolean;
  leaving: boolean;
}

export function ProgressToast({ toast, onDismiss, pluginUnloaded, leaving }: Props) {
  const { t } = useTranslation();
  const isFinished = !!toast.finished;
  const running = !isFinished && toast.progress !== undefined;

  return (
    <ToastStrip leaving={leaving} progress={running ? toast.progress : undefined}>
      <div className="flex items-center gap-2.5 min-h-6">
        <NotificationBadge
          source={toast.source}
          host={toast.host}
          severity={isFinished ? (toast.finishedSeverity ?? "success") : undefined}
          busy={!isFinished}
          halo={STRIP_SURFACE}
        />
        <span className="flex-1 min-w-0 truncate text-(--t-text-primary)" title={toast.message}>{toast.message}</span>
        <NotificationSourceLabel source={toast.source} host={toast.host} className="shrink-0 max-w-[9rem]" />
        {running && (
          <span className="text-xs tabular-nums shrink-0 text-(--t-text-muted)">{Math.round(toast.progress!)}%</span>
        )}
        {toast.cancellable && !isFinished && (
          <StripTextButton label={t("common.action.cancel")} onClick={onDismiss} disabled={pluginUnloaded} tone="muted" />
        )}
        {isFinished && toast.action && <StripTextButton label={toast.action.label} onClick={toast.action.onClick} />}
        {isFinished ? <StripDismissButton onClick={onDismiss} /> : !toast.cancellable && <span className="w-1 shrink-0" />}
      </div>

      {(toast.thumbnail || toast.detail) && (
        <div className="flex items-center gap-2.5 min-w-0 pl-7 pr-2 pb-1">
          {toast.thumbnail && (
            <img src={toast.thumbnail} alt="" className="h-7 w-11 rounded-[4px] object-cover shrink-0" style={{ boxShadow: "var(--t-ring)" }} />
          )}
          {toast.detail && <span className="text-[11.5px] truncate min-w-0 text-(--t-text-muted)">{toast.detail}</span>}
        </div>
      )}
    </ToastStrip>
  );
}
