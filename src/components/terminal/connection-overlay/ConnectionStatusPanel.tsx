import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { SLOW_RETRY_MS, type ReconnectWait } from "@/stores/reconnectBackoffCore";
import { useDismissBlocked } from "./dismissBlocked";

function PanelActions({
  retryLabel,
  onRetry,
  onDismiss,
}: {
  retryLabel: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const dismissBlocked = useDismissBlocked();
  return (
    <div className="mt-2 flex items-center gap-3 justify-center">
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs text-accent hover:text-accent/80 transition-colors underline"
        >
          {retryLabel}
        </button>
      )}
      <button
        onClick={onDismiss}
        disabled={!!dismissBlocked}
        title={dismissBlocked}
        className="text-xs text-text-muted hover:text-text-primary transition-colors underline disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {t("terminal.overlay.connectionError.dismiss")}
      </button>
    </div>
  );
}

export function ReconnectWaitPanel({
  wait,
  onRetryNow,
  onDismiss,
}: {
  wait: ReconnectWait;
  onRetryNow?: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="w-full p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-center">
      <p className="text-yellow-400 text-sm font-medium">{t(`terminal.overlay.reconnectWait.${wait}.title`)}</p>
      <p className="text-text-muted text-xs mt-1">
        {t(`terminal.overlay.reconnectWait.${wait}.subtitle`, { seconds: SLOW_RETRY_MS / 1000 })}
      </p>
      <PanelActions
        retryLabel={t("terminal.overlay.reconnectWait.retryNow")}
        onRetry={wait === "slow" ? onRetryNow : undefined}
        onDismiss={onDismiss}
      />
    </div>
  );
}

export function ConnectionErrorPanel({
  errorMessage,
  retryLabel,
  onRetry,
  onDismiss,
}: {
  errorMessage?: string;
  retryLabel?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="w-full p-3 rounded-lg bg-red-600/10 border border-red-600/20">
      <p className="text-status-error text-sm font-medium">{t("terminal.overlay.connectionError.title")}</p>
      {errorMessage && (
        <p className="text-status-error/80 text-xs mt-1 wrap-break-word">{errorMessage}</p>
      )}
      <PanelActions
        retryLabel={retryLabel ?? t("terminal.overlay.connectionError.retry")}
        onRetry={onRetry}
        onDismiss={onDismiss}
      />
    </div>
  );
}

/** Slim reconnect bar over a terminal that stays visible and scrollable (mobile). */
export function ReconnectBanner({
  wait,
  onRetryNow,
  onDismiss,
}: {
  wait?: ReconnectWait;
  onRetryNow?: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const dismissBlocked = useDismissBlocked();
  return (
    <>
      <div aria-hidden className="absolute inset-0 z-10 pointer-events-none"
        style={{ background: "color-mix(in srgb, var(--t-bg-terminal) 45%, transparent)" }} />
      <div data-reconnect-banner role="status"
        className="absolute inset-x-0 top-0 z-30 flex items-center gap-2.5 pl-3 pr-2 py-2 border-b"
        style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}>
        <Icon icon={wait === "offline" ? "lucide:wifi-off" : "lucide:loader-circle"} width={16}
          className={wait === "offline" ? "shrink-0 text-yellow-400" : "shrink-0 animate-spin text-(--t-accent)"} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-(--t-text-bright) truncate">
            {wait ? t(`terminal.overlay.reconnectWait.${wait}.title`) : t("terminal.overlay.reconnectBanner.reconnecting")}
          </p>
          {wait && (
            <p className="text-xs text-(--t-text-secondary) truncate">
              {t(`terminal.overlay.reconnectWait.${wait}.subtitle`, { seconds: SLOW_RETRY_MS / 1000 })}
            </p>
          )}
        </div>
        {wait === "slow" && onRetryNow && (
          <button onClick={onRetryNow} className="vt-hit shrink-0 px-2.5 py-1.5 rounded-md text-xs font-medium"
            style={{ background: "var(--t-accent)", color: "var(--t-on-accent)" }}>
            {t("terminal.overlay.reconnectWait.retryNow")}
          </button>
        )}
        <button onClick={onDismiss} disabled={!!dismissBlocked} title={dismissBlocked}
          className="vt-hit shrink-0 px-2.5 py-1.5 rounded-md text-xs font-medium text-(--t-text-primary) disabled:opacity-40"
          style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}>
          {t("terminal.overlay.reconnectBanner.closeTab")}
        </button>
      </div>
    </>
  );
}
